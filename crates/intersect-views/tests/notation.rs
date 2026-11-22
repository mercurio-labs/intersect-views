use intersect_views::NotationProfile;
use serde_json::Value;
type Result = std::result::Result<(), Box<dyn std::error::Error>>;
#[test]
fn shared_notation_vectors() -> Result {
    let accepted: Value = serde_json::from_str(include_str!("fixtures/notation-v1.json"))?;
    serde_json::from_value::<NotationProfile>(accepted.clone())?.validate()?;
    let vectors: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/notation-v1-rejections.json"))?;
    for vector in vectors {
        let mut value = accepted.clone();
        let pointer = vector["pointer"].as_str().ok_or("No pointer")?;
        let (parent, key) = pointer.rsplit_once('/').ok_or("Invalid pointer")?;
        let target = value
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .ok_or("Missing object")?;
        target.insert(key.into(), vector["value"].clone());
        let result = serde_json::from_value::<NotationProfile>(value)
            .map_err(|e| e.to_string())
            .and_then(|p| p.validate());
        assert!(result.is_err(), "Accepted {}", vector["name"]);
    }
    Ok(())
}
