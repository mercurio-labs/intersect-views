use intersect_views::{GraphRuleSet, RenderingRegistry, RenderingResolution, RuleSet};
#[test]
fn shared_rendering_contracts_and_explicit_migration() -> Result<(), Box<dyn std::error::Error>> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/rendering-v1-m14.json"))?;
    let rules: GraphRuleSet = serde_json::from_value(fixture["rules"].clone())?;
    for (group, accepted) in [("accepted", true), ("rejected", false)] {
        for case in fixture[group].as_array().ok_or("Missing cases")? {
            let value = case["value"].clone();
            let ok = if case["kind"] == "registry" {
                serde_json::from_value::<RenderingRegistry>(value)
                    .is_ok_and(|r| r.validate(std::slice::from_ref(&rules)).is_ok())
            } else {
                serde_json::from_value::<RenderingResolution>(value)
                    .is_ok_and(|r| r.validate().is_ok())
            };
            assert_eq!(ok, accepted, "{}", case["name"]);
        }
    }
    let old: serde_json::Value = serde_json::from_str(include_str!("fixtures/rule-set-v6.json"))?;
    assert!(serde_json::from_value::<RuleSet>(old.clone()).is_err());
    let migrated = intersect_views::migrate_rules_v6(old.clone())?;
    assert_eq!(migrated.graph()?.schema_version, 8);
    assert_eq!(old["schemaVersion"], 6);
    assert!(intersect_views::migrate_rules_v6(serde_json::to_value(migrated)?).is_err());
    Ok(())
}
