use anyhow::Result;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Debug, Deserialize)]
struct RpcResponse {
    result: Option<GetEventsResult>,
}

#[derive(Debug, Deserialize)]
struct GetEventsResult {
    events: Vec<SorobanEvent>,
    #[serde(rename = "latestLedger")]
    latest_ledger: u64,
}

#[derive(Debug, Deserialize)]
struct SorobanEvent {
    #[serde(rename = "pagingToken")]
    paging_token: String,
    #[serde(rename = "contractId")]
    contract_id: String,
    ledger: u64,
    #[serde(rename = "txHash")]
    tx_hash: String,
    #[serde(rename = "type")]
    event_type: String,
    topic: Vec<serde_json::Value>,
    value: Option<serde_json::Value>,
}

pub async fn index_contract_events(
    db: &PgPool,
    soroban_rpc_url: &str,
    contract_id: &str,
    start_ledger: u64,
) -> Result<u64> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getEvents",
        "params": {
            "startLedger": start_ledger,
            "filters": [{ "type": "contract", "contractIds": [contract_id] }],
            "pagination": { "limit": 200 }
        }
    });

    // Fetch raw JSON value so we can detect JSON-RPC errors and log their codes.
    let resp_value: serde_json::Value = client
        .post(soroban_rpc_url)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    if let Some(err) = resp_value.get("error") {
        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("(no message)");
        tracing::error!("soroban RPC error code {}: {}", code, message);
        return Err(anyhow::anyhow!("soroban RPC error {}: {}", code, message));
    }

    let resp: RpcResponse = serde_json::from_value(resp_value)?;

    let result = match resp.result {
        Some(r) => r,
        None => return Ok(start_ledger),
    };

    for event in &result.events {
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM soroban_contract_events WHERE paging_token=$1")
                .bind(&event.paging_token)
                .fetch_optional(db)
                .await?;
        if exists.is_some() {
            continue;
        }

        let invoice_id: Option<uuid::Uuid> = try_resolve_invoice(db, &event.topic).await?;
        let merchant_id: Option<uuid::Uuid> = if let Some(inv_id) = invoice_id {
            sqlx::query_scalar("SELECT merchant_id FROM invoices WHERE id=$1")
                .bind(inv_id)
                .fetch_optional(db)
                .await?
        } else {
            None
        };

        sqlx::query(
            r#"INSERT INTO soroban_contract_events
               (contract_id, ledger_sequence, paging_token, tx_hash, event_type, topics, value, invoice_id, merchant_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (paging_token) DO NOTHING"#,
        )
        .bind(&event.contract_id)
        .bind(event.ledger as i64)
        .bind(&event.paging_token)
        .bind(&event.tx_hash)
        .bind(&event.event_type)
        .bind(serde_json::Value::Array(event.topic.clone()))
        .bind(&event.value)
        .bind(invoice_id)
        .bind(merchant_id)
        .execute(db)
        .await?;
    }

    Ok(result.latest_ledger)
}

async fn try_resolve_invoice(db: &PgPool, topics: &[serde_json::Value]) -> Result<Option<uuid::Uuid>> {
    // Topics may encode a muxed_id; attempt to match against invoices
    for topic in topics {
        if let Some(s) = topic.as_str() {
            if let Ok(muxed_id) = s.parse::<i64>() {
                let id: Option<uuid::Uuid> =
                    sqlx::query_scalar("SELECT id FROM invoices WHERE muxed_id=$1")
                        .bind(muxed_id)
                        .fetch_optional(db)
                        .await?;
                if id.is_some() {
                    return Ok(id);
                }
            }
        }
    }
    Ok(None)
}
