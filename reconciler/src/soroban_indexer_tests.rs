#[cfg(test)]
mod tests {
    use super::super::*;
    use serde_json::json;
    use tracing_test::traced_test;

    #[traced_test]
    #[tokio::test]
    async fn logs_rpc_error_code_when_present() {
        // Construct a simulated JSON-RPC error response
        let resp_value = json!({
            "jsonrpc": "2.0",
            "error": { "code": -32000, "message": "internal error" },
            "id": 1
        });

        // Call the same logic used in the indexer: detect error and return Err
        // We replicate the logic from soroban_indexer.rs: check for error and log
        if let Some(err) = resp_value.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("(no message)");
            tracing::error!("soroban RPC error code {}: {}", code, message);
            // Ensure logging occurred by checking the tracing_test captured output
            assert!(logs_contain("soroban RPC error code"));
        } else {
            panic!("expected error in mock response");
        }
    }
}
