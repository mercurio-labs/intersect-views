use intersect_views::{
    GraphScene as Scene, PreparedEdit, SceneLimits, SceneResponse, ToolCapability,
};
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn fixture() -> Result<Value> {
    Ok(serde_json::from_str(include_str!(
        "../fixtures/scene-v6-m14.json"
    ))?)
}

#[test]
fn scene_v3_round_trips_without_losing_occurrence_context_or_source_bindings() -> Result {
    let value = fixture()?;
    let scene: Scene = serde_json::from_value(value.clone())?;
    scene.validate()?;
    assert_eq!(serde_json::to_value(&scene)?, value);
    assert_eq!(scene.nodes[0].binding.key, scene.nodes[1].binding.key);
    assert_ne!(scene.nodes[0].id, scene.nodes[1].id);
    assert_ne!(
        scene.nodes[0].binding.context,
        scene.nodes[1].binding.context
    );
    assert!(
        scene
            .validate_with_limits(SceneLimits {
                nodes: 1,
                ..Default::default()
            })
            .is_err()
    );
    Ok(())
}
#[test]
fn rust_rejects_the_shared_invalid_wire_vectors() -> Result {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../fixtures/scene-v6-rejections.json"))?;
    for case in cases {
        let mut value = fixture()?;
        let pointer = case["pointer"].as_str().ok_or("Missing fixture pointer")?;
        let (parent, key) = pointer.rsplit_once('/').ok_or("Bad fixture pointer")?;
        let object = value
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .ok_or("Missing fixture object")?;
        if case["remove"] == true {
            object.remove(key);
        } else {
            object.insert(key.into(), case["value"].clone());
        }
        let accepted =
            serde_json::from_value::<Scene>(value).is_ok_and(|scene| scene.validate().is_ok());
        assert!(!accepted, "accepted invalid vector: {}", case["name"]);
    }
    Ok(())
}
#[test]
fn every_tool_needs_one_capability_and_disabled_tools_need_a_reason() -> Result {
    let mut response = SceneResponse {
        presentation: Default::default(),
        scene: serde_json::from_value(fixture()?)?,
        capabilities: vec![ToolCapability {
            tool_id: "select".into(),
            enabled: true,
            reason: String::new(),
        }],
    };
    response.validate()?;
    response.capabilities[0].enabled = false;
    assert!(response.validate().is_err());
    response.capabilities[0].reason = "Unavailable for this revision".into();
    response.validate()?;
    response.capabilities.clear();
    assert!(response.validate().is_err());
    Ok(())
}
#[test]
fn prepared_source_edits_have_portable_revisions_ranges_and_buffer_hashes() -> Result {
    let mut edit: PreparedEdit = serde_json::from_value(
        json!({"schemaVersion":1,"token":"edit:1","baseRevision":1,"nextRevision":2,"created":"element:new","patches":[{
            "uri":"file:///example.model","range":{"start":{"line":0,"character":2},"end":{"line":0,"character":2}},
            "original":"","replacement":"new","beforeHash":"0".repeat(64),"afterHash":"a".repeat(64)
        }]}),
    )?;
    edit.validate()?;
    edit.next_revision = edit.base_revision;
    assert!(edit.validate().is_err());
    edit.next_revision += 1;
    edit.patches[0].before_hash = "bad".into();
    assert!(edit.validate().is_err());
    Ok(())
}

#[test]
fn shared_m8_graph_vectors() -> Result {
    let input = include_str!("../fixtures/graph-m12-m14.json");
    let accepted: Scene = serde_json::from_str(input)?;
    accepted.validate()?;
    for case in
        serde_json::from_str::<Vec<Value>>(include_str!("../fixtures/graph-m8-rejections.json"))?
    {
        let mut v: Value = serde_json::from_str(input)?;
        let pointer = case["pointer"].as_str().ok_or("No pointer")?;
        let (parent, key) = pointer.rsplit_once('/').ok_or("Bad pointer")?;
        match v.pointer_mut(parent).ok_or("Bad parent")? {
            Value::Object(target) => {
                if case["remove"] == true {
                    target.remove(key);
                } else {
                    target.insert(key.into(), case["value"].clone());
                }
            }
            Value::Array(target) => {
                let index = key.parse::<usize>()?;
                if case["remove"] == true {
                    target.remove(index);
                } else {
                    target[index] = case["value"].clone();
                }
            }
            _ => return Err("Invalid mutation parent".into()),
        }
        assert!(
            !serde_json::from_value::<Scene>(v).is_ok_and(|s| s.validate().is_ok()),
            "{}",
            case["name"]
        );
    }
    Ok(())
}

#[test]
fn graph_aggregate_part_and_encoded_byte_limits_fail_by_name() -> Result {
    let mut scene: Scene = serde_json::from_value(fixture()?)?;
    scene.nodes.truncate(1);
    scene.edges.clear();
    let base = scene.nodes[0].binding.clone();
    scene.nodes[0].title.parts.clear();
    scene.nodes[0].subtitle.parts.clear();
    scene.nodes[0].ports.clear();
    scene.nodes[0].compartments.clear();
    let rows = (0..5000)
        .map(|i| intersect_views::Row {
            id: format!("row:{i}"),
            binding: base.clone(),
            label: intersect_views::Label {
                parts: (0..5)
                    .map(|j| intersect_views::LabelPart {
                        id: format!("part:{i}:{j}"),
                        text: "x".into(),
                        binding: Some(base.clone()),
                        edit_tool: None,
                    })
                    .collect(),
            },
        })
        .collect();
    scene.nodes[0]
        .compartments
        .push(intersect_views::Compartment {
            id: "test-compartment".into(),
            label: "Fields".into(),
            rows,
        });
    assert!(
        scene
            .validate()
            .err()
            .ok_or("No part limit")?
            .contains("parts")
    );
    for row in &mut scene.nodes[0].compartments[0].rows {
        row.label.parts.truncate(1);
        row.label.parts[0].text = "x".repeat(2000);
    }
    assert!(
        scene
            .validate()
            .err()
            .ok_or("No encoded limit")?
            .contains("encoded")
    );
    Ok(())
}
