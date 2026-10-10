use anyhow::Result;
fn main() -> Result<()> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    for name in ["events.schema.json", "batch.schema.json"] {
        let schema: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("spec").join(name))?)?;
        anyhow::ensure!(
            schema["$schema"] == "https://json-schema.org/draft/2020-12/schema",
            "Expected official JSON Schema draft"
        );
    }
    println!("Official schemas parsed; runtime validation replaces generated wire types");
    Ok(())
}
