use intersect_view_host::Host;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn call(h: &mut Host, m: &str, p: Value) -> Result<Value> {
    Ok(h.dispatch(json!({"method":m,"params":p}))?)
}
struct Fixture {
    h: Host,
    sources: Vec<Value>,
    scope: Value,
    revision: u64,
}
impl Fixture {
    fn new() -> Result<Self> {
        Self::language(intersect_view_harness::definition())
    }
    fn language(language: intersect_view_host::LanguageDefinition) -> Result<Self> {
        let mut h = Host::new(language, Box::new(intersect_view_harness::HarnessCommands))?;
        let mut sources = vec![
            json!({"uri":"grid.harness","text":include_str!("../../../harness/models/grid.harness")}),
        ];
        for (key, rule) in [
            ("table", "harness.box-table"),
            ("matrix", "harness.trace-matrix"),
            ("derived", "harness.derived-matrix"),
        ] {
            sources.push(json!({"uri":format!("{key}.view.json"),"text":json!({"schemaVersion":1,"key":key,"name":key,"ruleSet":rule,"scope":{"schemaVersion":1,"ops":[]}}).to_string()}));
        }
        let a = call(
            &mut h,
            "workspace/analyze",
            json!({"revision":1,"sources":sources}),
        )?;
        assert_eq!(a["clean"], true, "{a}");
        let catalog = call(&mut h, "views/catalog", json!({"revision":1}))?;
        let owners = catalog["views"][0]["owners"]
            .as_array()
            .ok_or("No owners")?;
        let ops = owners
            .iter()
            .filter(|v| ["Alpha", "Beta", "Gamma"].iter().any(|n| v["label"] == *n))
            .map(|v| json!({"op":"addSeed","element":v["key"]}))
            .collect::<Vec<_>>();
        assert_eq!(ops.len(), 3);
        Ok(Self {
            h,
            sources,
            scope: json!({"schemaVersion":1,"ops":ops}),
            revision: 1,
        })
    }
    fn scene(&mut self, key: &str) -> Result<Value> {
        call(
            &mut self.h,
            "views/scene",
            json!({"revision":self.revision,"viewKey":key,"scope":self.scope}),
        )
    }
    fn prepare(
        &mut self,
        s: &Value,
        tool: &str,
        r: usize,
        c: usize,
        member: Option<&str>,
        name: &str,
    ) -> Result<Value> {
        let row = &s["scene"]["grid"]["rows"][r];
        let column = &s["scene"]["grid"]["columns"][c];
        let mut args = json!({"row":row["id"],"column":column["id"],"name":name});
        if let Some(m) = member {
            args["member"] = json!(m);
        }
        call(
            &mut self.h,
            "views/prepareCommand",
            json!({"revision":self.revision,"viewKey":"matrix","scope":self.scope,"toolId":tool,"ownerKey":row["binding"]["key"],"arguments":args}),
        )
    }
    fn commit(&mut self, p: &Value) -> Result {
        assert!(p["token"].is_string(), "{p}");
        for patch in p["patches"].as_array().ok_or("No patches")? {
            let doc = self
                .sources
                .iter_mut()
                .find(|s| s["uri"] == patch["uri"])
                .ok_or("No doc")?;
            let text = doc["text"].as_str().ok_or("No text")?;
            let offset = |v: &Value| -> usize {
                text.split_inclusive('\n')
                    .take(v["line"].as_u64().unwrap_or(0) as usize)
                    .map(str::len)
                    .sum::<usize>()
                    + v["character"].as_u64().unwrap_or(0) as usize
            };
            let mut after = text.to_owned();
            after.replace_range(
                offset(&patch["range"]["start"])..offset(&patch["range"]["end"]),
                patch["replacement"].as_str().ok_or("No replacement")?,
            );
            doc["text"] = json!(after);
        }
        let c = call(
            &mut self.h,
            "views/commitCommand",
            json!({"revision":self.revision,"token":p["token"],"sources":self.sources}),
        )?;
        assert!(c.get("rejection").is_none(), "{c}");
        self.revision = p["nextRevision"].as_u64().ok_or("No revision")?;
        Ok(())
    }
}
#[test]
fn query_table_sparse_matrix_and_parallel_member_edits() -> Result {
    let mut f = Fixture::new()?;
    let table = f.scene("table")?;
    assert_eq!(table["scene"]["grid"]["rows"][0]["label"], "Alpha");
    assert_eq!(
        table["scene"]["grid"]["cells"]
            .as_array()
            .ok_or("No cells")?
            .len(),
        4
    );
    assert_eq!(
        table["scene"]["grid"]["cells"][1]["value"],
        json!({"kind":"integer","value":"1"})
    );
    let scene = f.scene("matrix")?;
    assert_eq!(
        scene["scene"]["grid"]["cells"]
            .as_array()
            .ok_or("No cells")?
            .len(),
        1
    );
    let cell = &scene["scene"]["grid"]["cells"][0];
    assert_eq!(cell["value"], json!({"kind":"integer","value":"2"}));
    assert_ne!(
        cell["members"][0]["binding"]["key"],
        cell["members"][1]["binding"]["key"]
    );
    assert_eq!(
        serde_json::to_vec(&scene)?,
        serde_json::to_vec(&f.scene("matrix")?)?
    );
    let derived = f.scene("derived")?;
    assert_eq!(derived["scene"]["grid"]["cells"][0]["origin"], "derived");
    assert_eq!(
        derived["scene"]["grid"]["cells"][0]["value"],
        json!({"kind":"boolean","value":true})
    );
    // Occupied and self are checked independently; the latter is a language Issue.
    let occupied = f.prepare(&scene, "trace-add", 0, 1, None, "bad")?;
    assert!(
        occupied["message"]
            .as_str()
            .is_some_and(|s| s.contains("occupied")),
        "{occupied}"
    );
    let self_trace = f.prepare(&scene, "trace-add", 0, 0, None, "selfTrace")?;
    assert_eq!(self_trace["code"], "harness.trace.ends", "{self_trace}");
    let p = f.prepare(&scene, "trace-add", 1, 2, None, "created")?;
    assert_eq!(f.scene("matrix")?, scene);
    f.commit(&p)?;
    assert_eq!(
        f.scene("matrix")?["scene"]["grid"]["cells"]
            .as_array()
            .ok_or("No cells")?
            .len(),
        2
    );
    let scene = f.scene("matrix")?;
    let member = scene["scene"]["grid"]["cells"][0]["members"][1]["id"]
        .as_str()
        .ok_or("No member")?;
    let p = f.prepare(&scene, "trace-remove", 0, 1, Some(member), "")?;
    f.commit(&p)?;
    let scene = f.scene("matrix")?;
    assert_eq!(scene["scene"]["grid"]["cells"][0]["value"]["value"], "1");
    let member = scene["scene"]["grid"]["cells"][0]["members"][0]["id"]
        .as_str()
        .ok_or("No member")?;
    let p = f.prepare(&scene, "trace-remove", 0, 1, Some(member), "")?;
    f.commit(&p)?;
    assert_eq!(
        f.scene("matrix")?["scene"]["grid"]["cells"]
            .as_array()
            .ok_or("No cells")?
            .len(),
        1
    );
    assert!(
        f.sources[0]["text"]
            .as_str()
            .ok_or("No source")?
            .contains("// Parallel relations")
    );
    Ok(())
}
#[test]
fn targets_and_transactions_reject_wrong_members_stale_receipts_and_abort() -> Result {
    let mut f = Fixture::new()?;
    let scene = f.scene("matrix")?;
    let rows = &scene["scene"]["grid"]["rows"];
    let columns = &scene["scene"]["grid"]["columns"];
    let p = json!({"revision":1,"viewKey":"matrix","scope":f.scope,"toolId":"trace-add","row":rows[1]["id"],"column":columns[2]["id"]});
    let target = call(&mut f.h, "views/gridTargets", p.clone())?;
    assert_eq!(target["enabled"], true);
    assert_eq!(target["member"], Value::Null);
    let mut bad = p.clone();
    bad["revision"] = json!(0);
    assert!(call(&mut f.h, "views/gridTargets", bad).is_err());
    let mut bad = p.clone();
    bad["row"] = json!("unknown");
    assert!(call(&mut f.h, "views/gridTargets", bad).is_err());
    let mut bad = p.clone();
    bad["member"] = scene["scene"]["grid"]["cells"][0]["members"][0]["id"].clone();
    assert!(call(&mut f.h, "views/gridTargets", bad).is_err());
    let no_member = f.prepare(&scene, "trace-remove", 0, 1, None, "")?;
    assert!(
        no_member["message"]
            .as_str()
            .is_some_and(|s| s.contains("Choose"))
    );
    let duplicate = f.prepare(&scene, "trace-add", 1, 2, None, "first")?;
    assert_eq!(duplicate["code"], "harness.names.unique");
    let p = f.prepare(&scene, "trace-add", 1, 2, None, "Pending")?;
    assert!(p["token"].is_string());
    let second = f.prepare(&scene, "trace-add", 1, 2, None, "Other")?;
    assert!(second["code"].is_string());
    assert!(
        call(
            &mut f.h,
            "views/commitCommand",
            json!({"revision":1,"token":p["token"],"sources":f.sources})
        )
        .is_err()
    );
    assert_eq!(f.scene("matrix")?, scene);
    call(
        &mut f.h,
        "views/abortCommand",
        json!({"revision":1,"token":"wrong"}),
    )?;
    assert!(f.prepare(&scene, "trace-add", 1, 2, None, "StillPending")?["code"].is_string());
    call(
        &mut f.h,
        "views/abortCommand",
        json!({"revision":1,"token":p["token"]}),
    )?;
    let p = f.prepare(&scene, "trace-add", 1, 2, None, "NewPending")?;
    assert!(p["token"].is_string());
    call(
        &mut f.h,
        "workspace/analyze",
        json!({"revision":2,"sources":f.sources}),
    )?;
    assert!(
        call(
            &mut f.h,
            "views/commitCommand",
            json!({"revision":1,"token":p["token"],"sources":f.sources})
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn table_decoding_matches_native_query_scalars_references_lists_and_absence() -> Result {
    let mut language = intersect_view_harness::definition();
    let mut rules: Value = serde_json::from_str(&language.rule_sets[1])?;
    for (name, expression) in [
        ("reference", json!({"op":"field","path":"kind"})),
        ("values", json!({"op":"field","path":"fields"})),
        ("false", json!({"op":"literal","value":false})),
        ("empty", json!({"op":"literal","value":""})),
    ] {
        rules["grid"]["query"]["select"]
            .as_array_mut()
            .ok_or("No select")?
            .push(json!({"name":name,"expression":expression}));
        rules["grid"]["columns"]
            .as_array_mut()
            .ok_or("No columns")?
            .push(json!({"id":name,"label":name,"value":name}));
    }
    language.rule_sets[1] = rules.to_string();
    let mut f = Fixture::language(language)?;
    let scene = f.scene("table")?;
    let grid = &scene["scene"]["grid"];
    let candidates = grid["rows"]
        .as_array()
        .ok_or("No rows")?
        .iter()
        .map(|r| {
            r["binding"]["elementId"]
                .as_str()
                .map(str::to_owned)
                .ok_or("No element")
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let source = intersect_view_host::Source {
        uri: "grid.harness".into(),
        text: f.sources[0]["text"].as_str().ok_or("No source")?.into(),
    };
    let native = f.h.with_definition(|d| {
        let model = intersect_view_harness::load(d, &[source])?.model;
        let store = intersect_view_host::function_store(model)?;
        let query = intersect_view_host::grid_query::GridQuery::prepare(
            d.schema(),
            &rules["grid"]["query"],
        )?;
        query.execute(
            d.schema(),
            &store,
            &candidates,
            500,
            &mut intersect_model::core::query::QueryBudget::new(100000),
        )
    })?;
    let rows = grid["rows"].as_array().ok_or("No rows")?;
    let columns = grid["columns"].as_array().ok_or("No columns")?;
    let cells = grid["cells"].as_array().ok_or("No cells")?;
    for (row, values) in rows.iter().zip(&native.rows) {
        assert_eq!(row["label"], values[0]);
        for (i, column) in columns.iter().enumerate() {
            let cell = cells
                .iter()
                .find(|c| c["row"] == row["id"] && c["column"] == column["id"]);
            let v = &values[i + 1];
            if v.is_null() || v.as_array().is_some_and(Vec::is_empty) {
                assert!(cell.is_none());
                continue;
            }
            let cell = cell.ok_or("Missing present cell")?;
            let decoded = &cell["value"];
            match column["label"].as_str().ok_or("No label")? {
                "Kind" | "empty" => assert_eq!(*decoded, json!({"kind":"string","value":v})),
                "Own fields" => {
                    assert_eq!(*decoded, json!({"kind":"integer","value":v.to_string()}))
                }
                "false" => assert_eq!(*decoded, json!({"kind":"boolean","value":v})),
                "reference" => {
                    assert_eq!(decoded["kind"], "reference");
                    assert_eq!(decoded["binding"]["elementId"], *v);
                    assert_eq!(decoded["label"], "K");
                }
                "values" => {
                    assert_eq!(decoded["kind"], "list");
                    let items = decoded["items"].as_array().ok_or("No items")?;
                    let native = v.as_array().ok_or("No native list")?;
                    assert_eq!(items.len(), native.len());
                    for (item, id) in items.iter().zip(native) {
                        assert_eq!(item["kind"], "reference");
                        assert_eq!(item["binding"]["elementId"], *id);
                        assert_eq!(item["label"], "zero");
                    }
                }
                _ => return Err("Unexpected column".into()),
            }
        }
    }
    Ok(())
}
