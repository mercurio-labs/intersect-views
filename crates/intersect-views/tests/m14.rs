use intersect_views::{
    GraphRuleSet, GraphScene, LabelPlacement, Presentation, RouteConstraint, RoutingPolicy,
};
use serde_json::Value;

#[test]
fn shared_m14_wire_contract_vectors() -> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/m14-contracts-symbol.json"))?;
    for case in cases {
        macro_rules! accepts {
            ($ty:ty) => {
                serde_json::from_value::<$ty>(case["value"].clone())
                    .is_ok_and(|value| value.validate().is_ok())
            };
        }
        let accepted = match case["kind"].as_str().ok_or("Missing kind")? {
            "policy" => accepts!(RoutingPolicy),
            "constraint" => accepts!(RouteConstraint),
            "placement" => accepts!(LabelPlacement),
            "presentation" => accepts!(Presentation),
            "scene" => accepts!(GraphScene),
            "rules" => accepts!(GraphRuleSet),
            _ => return Err("Unknown fixture kind".into()),
        };
        assert_eq!(accepted, case["accepted"] == true, "{}", case["name"]);
    }
    Ok(())
}
