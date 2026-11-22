use intersect_views::{GridTargetResponse, RuleSet, Scene};
use serde_json::Value;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn accepts(kind: &str, v: Value) -> bool {
    match kind {
        "scene" => serde_json::from_value::<Scene>(v).is_ok_and(|s| s.validate().is_ok()),
        "rules" => serde_json::from_value::<RuleSet>(v).is_ok_and(|s| s.validate().is_ok()),
        "targets" => {
            serde_json::from_value::<GridTargetResponse>(v).is_ok_and(|s| s.validate().is_ok())
        }
        _ => false,
    }
}
#[test]
fn shared_strict_grid_contracts() -> Result {
    for (accept, input) in [
        (true, include_str!("fixtures/grid-v7-accepted-m14.json")),
        (false, include_str!("fixtures/grid-v7-rejected-m14.json")),
    ] {
        for c in serde_json::from_str::<Vec<Value>>(input)? {
            assert_eq!(
                accepts(c["kind"].as_str().ok_or("No kind")?, c["value"].clone()),
                accept,
                "{}",
                c["name"]
            );
        }
    }
    Ok(())
}
#[test]
fn all_finite_grid_wire_limits_fail_explicitly() -> Result {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/grid-v7-accepted-m14.json"))?;
    let base = cases
        .iter()
        .find(|c| c["name"] == "matrix")
        .ok_or("No matrix")?["value"]
        .clone();
    for (name, n) in [("rows", 501), ("columns", 129)] {
        let mut v = base.clone();
        let axis = v["grid"][name][0].clone();
        v["grid"][name] = Value::Array(
            (0..n)
                .map(|i| {
                    let mut a = axis.clone();
                    a["id"] = format!("{name}:{i}").into();
                    a["binding"]["key"] = format!("key:{i}").into();
                    a
                })
                .collect(),
        );
        v["grid"]["cells"] = serde_json::json!([]);
        let s: Scene = serde_json::from_value(v)?;
        assert!(s.validate().err().ok_or("No limit")?.contains(name));
    }
    let mut v = base.clone();
    v["grid"]["cells"] = Value::Array(vec![v["grid"]["cells"][0].clone(); 5001]);
    assert!(
        serde_json::from_value::<Scene>(v)?
            .validate()
            .err()
            .ok_or("No cells limit")?
            .contains("cells")
    );
    let mut v = base.clone();
    let member = v["grid"]["cells"][0]["members"][0].clone();
    v["grid"]["cells"][0]["members"] = Value::Array(
        (0..5001)
            .map(|i| {
                let mut m = member.clone();
                m["id"] = format!("member:{i}").into();
                m["binding"]["key"] = format!("m:{i}").into();
                m
            })
            .collect(),
    );
    v["grid"]["cells"][0]["value"]["value"] = "5001".into();
    v["grid"]["cells"][0]["binding"] = v["grid"]["cells"][0]["members"][0]["binding"].clone();
    assert!(
        serde_json::from_value::<Scene>(v)?
            .validate()
            .err()
            .ok_or("No members limit")?
            .contains("members")
    );
    let mut v = cases
        .iter()
        .find(|c| c["name"] == "table")
        .ok_or("No table")?["value"]
        .clone();
    v["grid"]["cells"][4]["value"]["items"] = Value::Array(vec![
        serde_json::json!({"kind":"integer","value":"0"});
        5001
    ]);
    assert!(
        serde_json::from_value::<Scene>(v)?
            .validate()
            .err()
            .ok_or("No list limit")?
            .contains("list items")
    );
    let mut v = cases
        .iter()
        .find(|c| c["name"] == "table")
        .ok_or("No table")?["value"]
        .clone();
    let col = v["grid"]["columns"][0].clone();
    v["grid"]["columns"] = Value::Array(vec![col; 31]);
    assert!(
        serde_json::from_value::<Scene>(v)?
            .validate()
            .err()
            .ok_or("No column limit")?
            .contains("columns")
    );
    // All values stay within their individual bounds; the whole wire still exceeds 8 MiB.
    let mut v = base;
    v["grid"]["kind"] = "table".into();
    v["grid"]["columns"] =
        serde_json::json!([{"id":"projection","label":"Text","scalar":"string","many":false}]);
    let mut rows = vec![];
    let mut cells = vec![];
    for i in 0..129 {
        let mut row = v["grid"]["rows"][0].clone();
        row["id"] = format!("row:{i}").into();
        row["binding"]["key"] = format!("key:{i}").into();
        let cell = serde_json::json!({"id":format!("cell:{i}"),"row":row["id"],"column":"projection","origin":"query","value":{"kind":"string","value":"x".repeat(65536)},"binding":row["binding"],"members":[]});
        rows.push(row);
        cells.push(cell);
    }
    v["grid"]["rows"] = rows.into();
    v["grid"]["cells"] = cells.into();
    assert!(
        serde_json::from_value::<Scene>(v)?
            .validate()
            .err()
            .ok_or("No encoded limit")?
            .contains("encoded")
    );
    Ok(())
}
