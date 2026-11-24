use intersect_views::{Presentation, RuleSet, Scene, Scope, TargetResponse, ViewDocument};
use serde_json::Value;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn fixture(name: &str) -> Result<Value> {
    Ok(serde_json::from_str(&std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))?)?)
}
fn accepts(kind: &str, value: Value) -> bool {
    macro_rules! check {
        ($ty:ty) => {
            serde_json::from_value::<$ty>(value).is_ok_and(|v| v.validate().is_ok())
        };
    }
    match kind {
        "scene" => check!(Scene),
        "scope" => check!(Scope),
        "view-document" => check!(ViewDocument),
        "presentation" => check!(Presentation),
        "rule-set" => check!(RuleSet),
        "targets" => check!(TargetResponse),
        _ => false,
    }
}
fn mutate(value: &mut Value, case: &Value) -> Result {
    let (parent, key) = case["pointer"]
        .as_str()
        .ok_or("Missing pointer")?
        .rsplit_once('/')
        .ok_or("Invalid pointer")?;
    let target = value.pointer_mut(parent).ok_or("Missing target")?;
    let replacement = if let Some(count) = case["repeat"].as_u64() {
        Value::Array(vec![case["value"].clone(); usize::try_from(count)?])
    } else if let Some(count) = case["repeatMap"].as_u64() {
        Value::Object(
            (0..count)
                .map(|i| (i.to_string(), case["value"].clone()))
                .collect(),
        )
    } else {
        case["value"].clone()
    };
    match target {
        Value::Object(object) => {
            if case["remove"] == true {
                object.remove(key);
            } else {
                object.insert(key.into(), replacement);
            }
        }
        Value::Array(array) => {
            let index = key.parse::<usize>()?;
            if case["remove"] == true {
                array.remove(index);
            } else {
                array[index] = replacement;
            }
        }
        _ => return Err("Invalid mutation target".into()),
    }
    Ok(())
}
#[test]
fn shared_documents_accept_and_round_trip() -> Result {
    macro_rules! round_trip {
        ($name:literal,$ty:ty) => {{
            let value = fixture(concat!($name, "-v1.json"))?;
            let typed: $ty = serde_json::from_value(value.clone())?;
            typed.validate()?;
            assert_eq!(serde_json::to_value(typed)?, value);
        }};
    }
    round_trip!("scope", Scope);
    round_trip!("view-document", ViewDocument);
    let value = fixture("presentation-v5.json")?;
    let typed: Presentation = serde_json::from_value(value.clone())?;
    typed.validate()?;
    assert_eq!(serde_json::to_value(typed)?, value);
    let value = fixture("rule-set-v7-m14.json")?;
    let typed: RuleSet = serde_json::from_value(value.clone())?;
    typed.validate()?;
    assert_eq!(serde_json::to_value(typed)?, value);
    round_trip!("targets", TargetResponse);
    Ok(())
}
#[test]
fn shared_root_only_filters_are_strict_booleans_for_both_edge_kinds() -> Result {
    for case in fixture("m10-root-only.json")?
        .as_array()
        .ok_or("No cases")?
    {
        for index in 0..2 {
            let mut rule = fixture("rule-set-v7-m14.json")?;
            rule["edges"][index]["rootOnly"] = case["value"].clone();
            assert_eq!(
                accepts("rule-set", rule),
                case["accepted"] == true,
                "{case}"
            );
        }
    }
    Ok(())
}
#[test]
fn shared_documents_reject_invalid_vectors() -> Result {
    for kind in [
        "scope",
        "view-document",
        "presentation",
        "rule-set",
        "targets",
    ] {
        let cases: Vec<Value> = serde_json::from_value(fixture(&format!(
            "{kind}-{}-rejections.json",
            if kind == "rule-set" {
                "v7"
            } else if kind == "presentation" {
                "v3"
            } else {
                "v1"
            }
        ))?)?;
        for case in cases {
            let mut value = fixture(&format!(
                "{kind}-{}.json",
                if kind == "rule-set" {
                    "v7-m14"
                } else if kind == "presentation" {
                    "v5"
                } else {
                    "v1"
                }
            ))?;
            mutate(&mut value, &case)?;
            assert!(!accepts(kind, value), "Accepted {kind}: {}", case["name"]);
        }
    }
    Ok(())
}
#[test]
fn shared_document_boundaries() -> Result {
    let cases: Vec<Value> = serde_json::from_value(fixture("document-boundaries-v5.json")?)?;
    for case in cases {
        let kind = case["kind"].as_str().ok_or("Missing kind")?;
        let mut value = fixture(&format!(
            "{kind}-{}.json",
            if kind == "rule-set" {
                "v7-m14"
            } else if kind == "scene" {
                "v6-m14"
            } else if kind == "presentation" {
                "v5"
            } else {
                "v1"
            }
        ))?;
        if let Some(count) = case["nodeCount"].as_u64() {
            let mut nodes = Vec::new();
            for index in 0..count {
                let mut node = value["nodes"][0].clone();
                node["id"] = format!("n{index}").into();
                node["title"] = serde_json::json!({"parts":[]});
                node["subtitle"] = serde_json::json!({"parts":[]});
                node["ports"] = Value::Array(vec![]);
                node["compartments"] = Value::Array(vec![]);
                node["children"] = Value::Array(vec![]);
                nodes.push(node);
            }
            value["nodes"] = Value::Array(nodes);
            value["edges"] = Value::Array(vec![]);
        } else {
            mutate(&mut value, &case)?;
        }
        assert_eq!(
            accepts(kind, value),
            case["accept"].as_bool().ok_or("Missing acceptance")?,
            "{}",
            case["name"]
        );
    }
    Ok(())
}
#[test]
fn legacy_scenes_are_not_silently_upgraded() -> Result {
    assert!(!accepts("scene", fixture("scene-v1.json")?));
    assert!(!accepts("scene", fixture("scene-v2.json")?));
    assert!(!accepts("rule-set", fixture("rule-set-v1.json")?));
    Ok(())
}
