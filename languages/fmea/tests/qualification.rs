use intersect_view_host::Host;
use intersect_views::{Position, SceneResponse, SourcePatch};
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    Ok(host.dispatch(json!({"method":method,"params":params}))?)
}
struct Fixture {
    host: Host,
    sources: Vec<Value>,
    revision: u64,
    owners: Vec<Value>,
}
impl Fixture {
    fn new() -> Result<Self> {
        let mut host = Host::new(
            intersect_fmea::definition(),
            Box::new(intersect_fmea::FmeaCommands),
        )?;
        let sources = vec![
            json!({"uri":"pump.fmea","text":include_str!("../models/pump.fmea")}),
            json!({"uri":"structure.view.json","text":include_str!("../models/structure.view.json")}),
            json!({"uri":"failures.view.json","text":include_str!("../models/failures.view.json")}),
            json!({"uri":"actions.view.json","text":include_str!("../models/actions.view.json")}),
            json!({"uri":"notes.txt","text":"Complete project receipt"}),
        ];
        let a = call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":sources}),
        )?;
        assert_eq!(a["clean"], true, "{a}");
        let c = call(&mut host, "views/catalog", json!({"revision":1}))?;
        let owners = c["views"][0]["owners"]
            .as_array()
            .ok_or("Missing owners")?
            .clone();
        Ok(Self {
            host,
            sources,
            revision: 1,
            owners,
        })
    }
    fn scope(&self, names: &[&str]) -> Result<Value> {
        let ops = names
            .iter()
            .map(|name| {
                self.owners
                    .iter()
                    .find(|o| o["label"] == *name)
                    .map(|o| json!({"op":"addSeed","element":o["key"]}))
                    .ok_or("Missing owner")
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(json!({"schemaVersion":1,"ops":ops}))
    }
    fn scene(&mut self, view: &str, names: &[&str]) -> Result<SceneResponse> {
        let scope = self.scope(names)?;
        let value = call(
            &mut self.host,
            "views/scene",
            json!({"revision":self.revision,"viewKey":view,"scope":scope}),
        )?;
        let scene: SceneResponse = serde_json::from_value(value)?;
        scene.validate()?;
        Ok(scene)
    }
    fn prepare(&mut self, tool: &str, owner: &str, part: &str, args: Value) -> Result<Value> {
        let scope = self.scope(&["PumpReview"])?;
        let mut args = args.as_object().ok_or("Missing arguments")?.clone();
        args.insert("part".into(), json!(part));
        call(
            &mut self.host,
            "views/prepareCommand",
            json!({"revision":self.revision,"viewKey":"structure","scope":scope,"toolId":tool,"ownerKey":owner,"arguments":args}),
        )
    }
    fn apply(&mut self, proposal: &Value) -> Result {
        for patch in proposal["patches"].as_array().ok_or("No patches")? {
            let p: SourcePatch = serde_json::from_value(patch.clone())?;
            let doc = self
                .sources
                .iter_mut()
                .find(|s| s["uri"] == p.uri)
                .ok_or("Missing source")?;
            let text = doc["text"].as_str().ok_or("No text")?;
            let start = offset(text, &p.range.start)?;
            let end = offset(text, &p.range.end)?;
            assert_eq!(&text[start..end], p.original);
            let mut next = text.to_owned();
            next.replace_range(start..end, &p.replacement);
            doc["text"] = json!(next);
        }
        Ok(())
    }
    fn commit(&mut self, p: &Value) -> Result {
        let result = call(
            &mut self.host,
            "views/commitCommand",
            json!({"revision":self.revision,"token":p["token"],"sources":self.sources}),
        )?;
        assert_eq!(result["clean"], true);
        self.revision = result["revision"].as_u64().ok_or("No revision")?;
        Ok(())
    }
    fn reanalyze(&mut self) -> Result<Value> {
        self.revision += 1;
        call(
            &mut self.host,
            "workspace/analyze",
            json!({"revision":self.revision,"sources":self.sources}),
        )
    }
}
fn offset(text: &str, p: &Position) -> Result<usize> {
    let mut start = 0;
    for _ in 0..p.line {
        start += text[start..].find('\n').ok_or("Bad line")? + 1;
    }
    let mut units = 0;
    for (i, c) in text[start..].char_indices() {
        if units == p.character {
            return Ok(start + i);
        }
        units += c.len_utf16();
    }
    if units == p.character {
        Ok(text.len())
    } else {
        Err("Bad UTF-16 position".into())
    }
}
fn node<'a>(nodes: &'a [intersect_views::Node], name: &str) -> Option<&'a intersect_views::Node> {
    for n in nodes {
        if n.title.text() == name {
            return Some(n);
        }
        if let Some(found) = node(&n.children, name) {
            return Some(found);
        }
    }
    None
}
#[test]
fn independent_registration_graph_and_native_worksheets() -> Result {
    let mut f = Fixture::new()?;
    let init = call(&mut f.host, "initialize", json!({"protocolVersion":2}))?;
    assert_eq!(init["language"]["id"], "fmea");
    let a = f.scene("structure", &["PumpReview"])?;
    let g = a.scene.graph()?;
    assert_eq!(g.nodes.len(), 1);
    assert_eq!(g.nodes[0].children[0].children.len(), 2);
    assert_eq!(
        node(&g.nodes, "NoFlow")
            .ok_or("Missing failure")?
            .subtitle
            .text(),
        "RPN 96"
    );
    assert_eq!(
        node(&g.nodes, "LowFlow")
            .ok_or("Missing failure")?
            .subtitle
            .text(),
        "RPN 120"
    );
    assert_eq!(
        serde_json::to_vec(&a)?,
        serde_json::to_vec(&f.scene("structure", &["PumpReview"])?)?
    );
    let table = f.scene("failures", &["NoFlow", "LowFlow"])?;
    let t = table.scene.grid()?;
    assert_eq!(t.grid.rows().len(), 2);
    assert_eq!(t.grid.cells().len(), 14);
    assert!(
        t.grid
            .cells()
            .iter()
            .any(|c| matches!(&c.value,intersect_views::GridValue::Integer{value}if value=="8"))
    );
    let actions = f.scene("actions", &["BackupPower", "AlarmTest", "FilterMonitor"])?;
    assert_eq!(actions.scene.grid()?.grid.rows().len(), 3);
    assert_eq!(actions.scene.grid()?.grid.cells().len(), 12);
    Ok(())
}
#[test]
fn risk_number_is_executed_in_rcore_at_all_decimal_widths() -> Result {
    let mut f = Fixture::new()?;
    let original = f.sources[0]["text"].as_str().ok_or("No text")?.to_owned();
    for (s, o, d, expected) in [
        (1, 1, 1, "RPN 1"),
        (1, 1, 9, "RPN 9"),
        (1, 2, 5, "RPN 10"),
        (8, 3, 4, "RPN 96"),
        (10, 1, 10, "RPN 100"),
        (6, 4, 5, "RPN 120"),
        (9, 9, 9, "RPN 729"),
        (10, 10, 10, "RPN 1000"),
    ] {
        f.sources[0]["text"] =
            json!(original.replace("ratings 8 3 4", &format!("ratings {s} {o} {d}")));
        assert_eq!(f.reanalyze()?["clean"], true);
        let scene = f.scene("structure", &["PumpReview"])?;
        assert_eq!(
            node(&scene.scene.graph()?.nodes, "NoFlow")
                .ok_or("No NoFlow")?
                .subtitle
                .text(),
            expected
        );
    }
    Ok(())
}
#[test]
fn rating_edits_preserve_comments_utf16_and_candidate_isolation() -> Result {
    let mut f = Fixture::new()?;
    let original = f.sources[0]["text"]
        .as_str()
        .ok_or("No text")?
        .replace(
            "ratings 8 3 4",
            "/* 🧭 */ ratings 8 /* occurrence */ 3 /* detection */ 4",
        )
        .replace("\n", "\r\n");
    f.sources[0]["text"] = json!(original);
    assert_eq!(f.reanalyze()?["clean"], true);
    let a = f.scene("structure", &["PumpReview"])?;
    let n = node(&a.scene.graph()?.nodes, "NoFlow").ok_or("No NoFlow")?;
    let part = &n.subtitle.parts[0].id;
    let p = f.prepare(
        "rate",
        &n.binding.key,
        part,
        json!({"severity":"10","occurrence":"10","detection":"10"}),
    )?;
    assert!(p["token"].is_string(), "{p}");
    assert_eq!(p["patches"].as_array().ok_or("No patches")?.len(), 1);
    assert_eq!(
        call(&mut f.host, "intersect/source", json!({"uri":"pump.fmea"}))?["text"],
        original
    );
    f.apply(&p)?;
    assert!(
        f.sources[0]["text"]
            .as_str()
            .ok_or("No text")?
            .contains("ratings 10 /* occurrence */ 10 /* detection */ 10")
    );
    f.commit(&p)?;
    let b = f.scene("structure", &["PumpReview"])?;
    let updated = node(&b.scene.graph()?.nodes, "NoFlow").ok_or("No updated failure")?;
    assert_eq!(updated.subtitle.text(), "RPN 1000");
    assert_eq!(&updated.subtitle.parts[0].id, part);
    Ok(())
}
#[test]
fn invalid_ratings_and_action_completion_are_structured_rejections() -> Result {
    let mut f = Fixture::new()?;
    let a = f.scene("structure", &["PumpReview"])?;
    let n = node(&a.scene.graph()?.nodes, "NoFlow").ok_or("No failure")?;
    for (name, s, o, d) in [
        ("severity", "0", "3", "4"),
        ("occurrence", "8", "11", "4"),
        ("detection", "8", "3", "0"),
    ] {
        let p = f.prepare(
            "rate",
            &n.binding.key,
            &n.subtitle.parts[0].id,
            json!({"severity":s,"occurrence":o,"detection":d}),
        )?;
        assert_eq!(p["code"], format!("fmea.rating.{name}"), "{p}");
        assert_eq!(p["feature"], name);
    }
    let action = node(&a.scene.graph()?.nodes, "BackupPower").ok_or("No action")?;
    let p = f.prepare(
        "action-status",
        &action.binding.key,
        &action.subtitle.parts[0].id,
        json!({"owner":"Systems team","status":"done","evidence":""}),
    )?;
    assert_eq!(p["code"], "fmea.action.evidence");
    assert_eq!(
        call(&mut f.host, "intersect/source", json!({"uri":"pump.fmea"}))?["text"],
        f.sources[0]["text"]
    );
    Ok(())
}
#[test]
fn action_edit_escapes_strings_and_receipts_abort_staleness_and_source_undo_hold() -> Result {
    let mut f = Fixture::new()?;
    let original = f.sources.clone();
    let scene = f.scene("structure", &["PumpReview"])?;
    let action = node(&scene.scene.graph()?.nodes, "BackupPower").ok_or("No action")?;
    let part = &action.subtitle.parts[0].id;
    let wrong = f.prepare(
        "action-status",
        "forged-owner",
        part,
        json!({"owner":"QA","status":"done","evidence":"R1"}),
    )?;
    assert_eq!(wrong["code"], "edit.rejected");
    let wrong = f.prepare(
        "rate",
        &action.binding.key,
        part,
        json!({"severity":"1","occurrence":"1","detection":"1"}),
    )?;
    assert_eq!(wrong["code"], "label.inapplicable");
    let owner = "QA \"north\"";
    let evidence = "Report 🧭 \\ server\nSection 2";
    let p = f.prepare(
        "action-status",
        &action.binding.key,
        part,
        json!({"owner":owner,"status":"done","evidence":evidence}),
    )?;
    assert!(p["token"].is_string(), "{p}");
    assert_eq!(
        f.prepare(
            "action-status",
            &action.binding.key,
            part,
            json!({"owner":owner,"status":"done","evidence":evidence})
        )?["code"],
        "edit.pending"
    );
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({"revision":1,"token":p["token"],"sources":f.sources[..4]})
        )
        .is_err()
    );
    call(&mut f.host, "views/abortCommand", json!({"token":"other"}))?;
    f.apply(&p)?;
    f.commit(&p)?;
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({"revision":1,"token":p["token"],"sources":f.sources})
        )
        .is_err()
    );
    let table = f.scene("actions", &["BackupPower"])?;
    assert!(
        table
            .scene
            .grid()?
            .grid
            .cells()
            .iter()
            .any(|c| matches!(&c.value,intersect_views::GridValue::String{value}if value==owner))
    );
    assert!(
        table.scene.grid()?.grid.cells().iter().any(
            |c| matches!(&c.value,intersect_views::GridValue::String{value}if value==evidence)
        )
    );
    f.sources = original;
    assert_eq!(f.reanalyze()?["clean"], true);
    let old = f.scene("structure", &["PumpReview"])?;
    assert_eq!(
        node(&old.scene.graph()?.nodes, "BackupPower")
            .ok_or("No action")?
            .subtitle
            .text(),
        "planned"
    );
    Ok(())
}
#[test]
fn foreign_language_buffers_are_documents_and_unknown_view_rules_are_not_admitted() -> Result {
    let mut f = Fixture::new()?;
    f.sources
        .push(json!({"uri":"foreign.harness","text":"not FMEA syntax"}));
    assert_eq!(f.reanalyze()?["clean"], true);
    assert!(
        call(
            &mut f.host,
            "views/scene",
            json!({"revision":f.revision,"viewKey":"foreign"})
        )
        .is_err()
    );
    let s = f.scene("structure", &["PumpReview"])?;
    assert_eq!(s.scene.graph()?.nodes.len(), 1);
    Ok(())
}

#[test]
fn domain_text_and_unique_names_report_located_issues() -> Result {
    let mut f = Fixture::new()?;
    let original = f.sources[0]["text"].as_str().ok_or("No text")?.to_owned();
    for (old, new, code, feature) in [
        (
            "function \"Deliver coolant at the specified flow\"",
            "function \"\"",
            "fmea.item.function",
            "function",
        ),
        (
            "mode \"Pump stops delivering flow\"",
            "mode \"\"",
            "fmea.failure.mode",
            "mode",
        ),
        (
            "effect \"Coolant flow is unavailable\"",
            "effect \"\"",
            "fmea.failure.effect",
            "effect",
        ),
        (
            "cause \"Motor loses electrical supply\"",
            "cause \"\"",
            "fmea.failure.cause",
            "cause",
        ),
        (
            "control \"Flow sensor and low-flow alarm\"",
            "control \"\"",
            "fmea.failure.control",
            "control",
        ),
        (
            "description \"Evaluate an independent supply\"",
            "description \"\"",
            "fmea.action.description",
            "description",
        ),
        (
            "action AlarmTest",
            "action BackupPower",
            "fmea.names.unique",
            "name",
        ),
    ] {
        f.sources[0]["text"] = json!(format!("/* 🧭 */\n{}", original.replace(old, new)));
        let a = f.reanalyze()?;
        assert_eq!(a["clean"], false, "{a}");
        let diagnostics = a["diagnostics"].as_array().ok_or("Missing diagnostics")?;
        assert_eq!(diagnostics.len(), 1, "{a}");
        assert_eq!(diagnostics[0]["code"], code);
        assert_eq!(diagnostics[0]["feature"], feature);
        assert_eq!(diagnostics[0]["uri"], "pump.fmea");
        assert!(diagnostics[0]["range"]["start"]["line"].is_number());
    }
    Ok(())
}
