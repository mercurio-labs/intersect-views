use intersect_views::{LaneGraphRuleSet, LaneGraphScene, LaneTargetResponse, RuleSet, Scene};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn vectors<T: DeserializeOwned + Serialize>(
    text: &str,
    rejections: &str,
    validate: fn(&T) -> std::result::Result<(), String>,
) -> Result {
    let base: Value = serde_json::from_str(text)?;
    let accepted: T = serde_json::from_value(base.clone())?;
    validate(&accepted)?;
    assert_eq!(serde_json::to_value(&accepted)?, base);
    for case in serde_json::from_str::<Vec<Value>>(rejections)? {
        let mut value = base.clone();
        let pointer = case["pointer"]
            .as_str()
            .ok_or("Missing rejection pointer")?;
        let (parent, key) = pointer
            .rsplit_once('/')
            .ok_or("Invalid rejection pointer")?;
        let object = value
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .ok_or("Missing rejection parent")?;
        if case["remove"] == true {
            object.remove(key);
        } else {
            object.insert(key.into(), case["value"].clone());
        }
        let valid = serde_json::from_value::<T>(value).is_ok_and(|v| validate(&v).is_ok());
        assert!(!valid, "accepted invalid lane vector: {}", case["name"]);
    }
    Ok(())
}

#[test]
fn strict_shared_lane_scene_rules_and_target_vectors() -> Result {
    vectors(
        include_str!("fixtures/lane-scene-v6-m14.json"),
        include_str!("fixtures/lane-scene-v6-rejections.json"),
        LaneGraphScene::validate,
    )?;
    vectors(
        include_str!("fixtures/lane-rules-v7-m14.json"),
        include_str!("fixtures/lane-rules-v7-rejections.json"),
        LaneGraphRuleSet::validate,
    )?;
    vectors(
        include_str!("fixtures/lane-targets-v1.json"),
        include_str!("fixtures/lane-targets-v1-rejections.json"),
        LaneTargetResponse::validate,
    )?;
    let scene: Scene = serde_json::from_str(include_str!("fixtures/lane-scene-v6-m14.json"))?;
    scene.validate()?;
    let rules: RuleSet = serde_json::from_str(include_str!("fixtures/lane-rules-v7-m14.json"))?;
    rules.validate()?;
    Ok(())
}

#[test]
fn lane_scene_count_limits_and_required_nullable_targets_are_literal() -> Result {
    let scene: LaneGraphScene =
        serde_json::from_str(include_str!("fixtures/lane-scene-v6-m14.json"))?;
    let mut lanes = scene.clone();
    lanes.lanes = vec![lanes.lanes[0].clone(); 129];
    assert!(lanes.validate().is_err_and(|e| e.contains("lanes")));
    let mut steps = scene.clone();
    steps.steps = vec![steps.steps[0].clone(); 501];
    assert!(steps.validate().is_err_and(|e| e.contains("steps")));
    let mut spans = scene.clone();
    spans.spans = vec![spans.spans[0].clone(); 501];
    assert!(spans.validate().is_err_and(|e| e.contains("spans")));
    let mut arcs = scene.clone();
    arcs.steps[0].predecessors = vec![arcs.steps[1].id.clone(); 4001];
    assert!(arcs.validate().is_err_and(|e| e.contains("arcs")));
    let base: Value = serde_json::from_str(include_str!("fixtures/lane-targets-v1.json"))?;
    for field in ["before", "end"] {
        let mut missing = base.clone();
        missing
            .as_object_mut()
            .ok_or("Expected target object")?
            .remove(field);
        assert!(serde_json::from_value::<LaneTargetResponse>(missing).is_err());
        let mut null = base.clone();
        null[field] = Value::Null;
        serde_json::from_value::<LaneTargetResponse>(null)?.validate()?;
    }
    Ok(())
}

#[test]
fn lane_presentation_is_strictly_tagged_and_has_no_semantic_geometry() -> Result {
    let p = serde_json::json!({"schemaVersion":4,"views":{"lanes":{"form":"laneGraph","packageFingerprint":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","projection":"fixture","laneOrder":["a","b"],"viewport":{"x":0,"y":0,"zoom":1}}}});
    serde_json::from_value::<intersect_views::Presentation>(p.clone())?.validate()?;
    for (key, value) in [
        ("positions", serde_json::json!({})),
        ("rank", serde_json::json!(2)),
        ("laneOrder", serde_json::json!(["a", "a"])),
    ] {
        let mut bad = p.clone();
        bad["views"]["lanes"][key] = value;
        assert!(
            !serde_json::from_value::<intersect_views::Presentation>(bad)
                .is_ok_and(|p| p.validate().is_ok())
        );
    }
    assert!(
        !serde_json::from_str::<intersect_views::Presentation>(include_str!(
            "fixtures/presentation-v1.json"
        ))
        .is_ok_and(|p| p.validate().is_ok())
    );
    for name in ["scene-v4.json", "rule-set-v4.json"] {
        let text = std::fs::read_to_string(format!(
            "{}/tests/fixtures/{name}",
            env!("CARGO_MANIFEST_DIR")
        ))?;
        if name.starts_with("scene") {
            assert!(!serde_json::from_str::<Scene>(&text).is_ok_and(|s| s.validate().is_ok()));
        } else {
            assert!(!serde_json::from_str::<RuleSet>(&text).is_ok_and(|s| s.validate().is_ok()));
        }
    }
    Ok(())
}

#[test]
fn lane_container_part_and_encoded_limits_fail_by_name() -> Result {
    let original: LaneGraphScene =
        serde_json::from_str(include_str!("fixtures/lane-scene-v6-m14.json"))?;
    let mut containers = original.clone();
    containers.steps.clear();
    containers.spans.clear();
    containers.order.clear();
    containers.lanes = (0..33)
        .map(|i| {
            let mut l = original.lanes[0].clone();
            l.id = format!("lane:{i}");
            l.container = format!("container:{i}");
            l.binding.key = format!("element:{i}");
            l.binding.context = vec![l.container.clone()];
            l.label.parts.clear();
            l
        })
        .collect();
    assert!(
        containers
            .validate()
            .is_err_and(|e| e.contains("containers"))
    );
    let mut encoded = original.clone();
    encoded.problems.push("x".repeat(8 * 1024 * 1024));
    assert!(encoded.validate().is_err_and(|e| e.contains("encoded")));
    let mut parts = original.clone();
    parts.spans.clear();
    parts.lanes = (0..128)
        .map(|i| {
            let mut l = original.lanes[0].clone();
            l.id = format!("lane:{i}");
            l.binding.key = format!("lane-key:{i}");
            l.label.parts = (0..32)
                .map(|j| {
                    let mut p = l.label.parts[0].clone();
                    p.id = format!("lane-part:{i}:{j}");
                    p
                })
                .collect();
            l
        })
        .collect();
    parts.steps = (0..500)
        .map(|i| {
            let mut s = original.steps[0].clone();
            s.id = format!("step:{i}");
            s.binding.key = format!("step-key:{i}");
            s.lane = parts.lanes[0].id.clone();
            s.rank = i;
            s.unordered = true;
            s.predecessors.clear();
            s.label.parts = (0..32)
                .map(|j| {
                    let mut p = s.label.parts[0].clone();
                    p.id = format!("step-part:{i}:{j}");
                    p
                })
                .collect();
            s
        })
        .collect();
    parts.order = parts.steps.iter().map(|s| s.id.clone()).collect();
    assert!(parts.validate().is_err_and(|e| e.contains("label parts")));
    Ok(())
}
