use intersect_view_harness::HarnessCommands;
use intersect_view_host::{
    CommandContext, CommandError, Commands, Host, insert_member, source_patch,
};
use intersect_views::{Position, PrepareCommand, Range, SourcePatch};
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[test]
fn target_predicates_resolve_anonymous_occurrence_binding_keys() -> Result {
    let mut language = intersect_view_harness::definition();
    language.name_features.clear();
    let mut host = Host::new(language, Box::new(HarnessCommands))?;
    let text = include_str!("../../../harness/models/structure.harness");
    call(
        &mut host,
        "workspace/analyze",
        json!({"revision":1,"sources":[{"uri":"structure.harness","text":text},{"uri":"structure.view.json","text":include_str!("../../../harness/models/structure.view.json")}]}),
    )?;
    let prefix = &text[..text.find("box Alpha").ok_or("No Alpha")?];
    let located = call(
        &mut host,
        "views/locate",
        json!({"revision":1,"uri":"structure.harness","position":{"line":prefix.bytes().filter(|c|*c==b'\n').count(),"character":prefix.rsplit('\n').next().unwrap_or("").encode_utf16().count()}}),
    )?;
    let response = call(
        &mut host,
        "views/targets",
        json!({"revision":1,"viewKey":"structure-1","toolId":"box","scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":located["key"]}]}}),
    )?;
    assert_eq!(response["symbols"].as_array().ok_or("No targets")?.len(), 4);
    Ok(())
}
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    Ok(host.dispatch(json!({"method":method,"params":params}))?)
}
struct Fixture {
    host: Host,
    sources: Vec<Value>,
    scope: Value,
    view: String,
    owner: Value,
    scene: Value,
}
impl Fixture {
    fn new(commands: Box<dyn Commands>, default_palette: bool) -> Result<Self> {
        let mut language = intersect_view_harness::definition();
        if default_palette {
            language.palette.clear();
        }
        let mut host = Host::new(language, commands)?;
        let sources = vec![
            json!({"uri":"structure.harness","text":include_str!("../../../harness/models/structure.harness")}),
            json!({"uri":"structure.view.json","text":include_str!("../../../harness/models/structure.view.json")}),
            json!({"uri":"notes.txt","text":"project receipt"}),
        ];
        let analyzed = call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":sources}),
        )?;
        assert_eq!(analyzed["clean"], true);
        let catalog = call(&mut host, "views/catalog", json!({"revision":1}))?;
        let view = catalog["views"][0]["key"].as_str().ok_or("No view")?.into();
        let owner = catalog["views"][0]["owners"]
            .as_array()
            .ok_or("No owners")?
            .iter()
            .find(|o| o["label"] == "Alpha")
            .ok_or("No Alpha")?["key"]
            .clone();
        let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":owner}]});
        let mut fixture = Self {
            host,
            sources,
            scope,
            view,
            owner,
            scene: Value::Null,
        };
        fixture.refresh(1)?;
        Ok(fixture)
    }
    fn refresh(&mut self, revision: u64) -> Result {
        self.scene = call(
            &mut self.host,
            "views/scene",
            json!({"revision":revision,"viewKey":self.view,"scope":self.scope}),
        )?;
        Ok(())
    }
    fn prepare(&mut self, revision: u64, tool: &str, args: Value) -> Result<Value> {
        call(
            &mut self.host,
            "views/prepareCommand",
            json!({"revision":revision,"viewKey":self.view,"scope":self.scope,"toolId":tool,"ownerKey":self.owner,"arguments":args}),
        )
    }
    fn apply(&mut self, prepared: &Value) -> Result {
        for patch in prepared["patches"].as_array().ok_or("No patches")? {
            let p: SourcePatch = serde_json::from_value(patch.clone())?;
            let source = self
                .sources
                .iter_mut()
                .find(|s| s["uri"] == p.uri)
                .ok_or("Missing buffer")?;
            let text = source["text"].as_str().ok_or("Missing text")?;
            fn offset(text: &str, p: &Position) -> Result<usize> {
                let mut lines = text.split_inclusive('\n');
                let mut start = 0;
                for _ in 0..p.line {
                    start += lines.next().ok_or("Missing line")?.len();
                }
                let line = lines.next().unwrap_or("");
                let mut units = 0;
                for (i, c) in line.char_indices() {
                    if units == p.character {
                        return Ok(start + i);
                    }
                    units += c.len_utf16();
                }
                if units == p.character {
                    Ok(start + line.len())
                } else {
                    Err("Invalid position".into())
                }
            }
            let (start, end) = (offset(text, &p.range.start)?, offset(text, &p.range.end)?);
            assert_eq!(&text[start..end], p.original);
            let mut after = text.to_owned();
            after.replace_range(start..end, &p.replacement);
            source["text"] = json!(after);
        }
        Ok(())
    }
    fn commit(&mut self, prepared: &Value) -> Result<Value> {
        call(
            &mut self.host,
            "views/commitCommand",
            json!({"revision":prepared["baseRevision"],"token":prepared["token"],"sources":self.sources}),
        )
    }
}
#[test]
fn all_commands_isolate_candidates_validate_receipts_and_allow_source_undo() -> Result {
    let mut f = Fixture::new(Box::new(HarnessCommands), false)?;
    let original = f.sources.clone();
    let prepared = f.prepare(1, "box", json!({"name":"CreatedBox"}))?;
    assert!(
        prepared["token"]
            .as_str()
            .ok_or("No token")?
            .starts_with("edit:1:"),
        "{prepared}"
    );
    assert!(
        prepared["created"]
            .as_str()
            .is_some_and(|s| s.starts_with("element:"))
    );
    assert_eq!(
        call(
            &mut f.host,
            "intersect/source",
            json!({"uri":"structure.harness"})
        )?["text"],
        original[0]["text"]
    );
    assert_eq!(
        f.prepare(1, "pin", json!({"name":"busy"}))?["code"],
        "edit.pending"
    );
    call(
        &mut f.host,
        "views/abortCommand",
        json!({"token":"unrelated"}),
    )?;
    assert!(f.commit(&prepared).is_err()); // unapplied receipt
    f.apply(&prepared)?;
    let mut short = f.sources.clone();
    short.pop();
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({"revision":1,"token":prepared["token"],"sources":short})
        )
        .is_err()
    );
    let mut duplicate = f.sources.clone();
    duplicate[2] = duplicate[1].clone();
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({"revision":1,"token":prepared["token"],"sources":duplicate})
        )
        .is_err()
    );
    let mut changed = f.sources.clone();
    changed[2]["text"] = json!("typing in a document");
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({"revision":1,"token":prepared["token"],"sources":changed})
        )
        .is_err()
    );
    assert_eq!(f.commit(&prepared)?["revision"], 2);
    assert!(f.commit(&prepared).is_err());
    f.refresh(2)?;
    assert!(
        f.scene["scene"]["nodes"][0]["children"]
            .as_array()
            .ok_or("No children")?
            .iter()
            .any(|n| n["title"]["parts"][0]["text"] == "CreatedBox")
    );
    let pin = f.prepare(2, "pin", json!({"name":"createdPin","direction":"in"}))?;
    f.apply(&pin)?;
    assert_eq!(f.commit(&pin)?["revision"], 3);
    f.refresh(3)?;
    assert!(
        f.scene["scene"]["nodes"][0]["ports"]
            .as_array()
            .ok_or("No ports")?
            .iter()
            .any(|p| p["label"]["parts"][0]["text"] == "createdPin")
    );
    let children = f.scene["scene"]["nodes"][0]["children"]
        .as_array()
        .ok_or("No children")?;
    let source = children
        .iter()
        .find(|n| n["title"]["parts"][0]["text"] == "Local")
        .ok_or("No Local")?["ports"][0]["id"]
        .clone();
    let target = children
        .iter()
        .find(|n| n["title"]["parts"][0]["text"] == "Mirror")
        .ok_or("No Mirror")?["ports"][0]["id"]
        .clone();
    let link = f.prepare(
        3,
        "link",
        json!({"name":"createdWire","source":source,"target":target}),
    )?;
    f.apply(&link)?;
    assert_eq!(f.commit(&link)?["revision"], 4);
    f.refresh(4)?;
    assert!(
        f.scene["scene"]["edges"]
            .as_array()
            .ok_or("No edges")?
            .iter()
            .any(|e| e["label"]["parts"][0]["text"] == "createdWire")
    );
    let undo = call(
        &mut f.host,
        "workspace/analyze",
        json!({"revision":5,"sources":original}),
    )?;
    assert_eq!(undo["clean"], true);
    assert!(
        !undo["nodes"]
            .as_array()
            .ok_or("No nodes")?
            .iter()
            .any(|n| n["name"] == "CreatedBox")
    );
    Ok(())
}
#[test]
fn legality_default_palette_stale_tokens_and_abort_are_authoritative() -> Result {
    let mut f = Fixture::new(Box::new(HarnessCommands), true)?;
    let tools = f.scene["scene"]["palette"]["groups"][0]["entries"]
        .as_array()
        .ok_or("No tools")?;
    assert_eq!(tools.len(), 4);
    let ids = call(
        &mut f.host,
        "views/targets",
        json!({"revision":1,"viewKey":f.view,"scope":f.scope,"toolId":"pin"}),
    )?;
    assert_eq!(ids["symbols"].as_array().ok_or("No targets")?.len(), 4);
    let children = f.scene["scene"]["nodes"][0]["children"]
        .as_array()
        .ok_or("No children")?;
    let source = children
        .iter()
        .find(|n| n["title"]["parts"][0]["text"] == "Local")
        .ok_or("No Local")?["ports"][0]["id"]
        .clone();
    let starts = call(
        &mut f.host,
        "views/targets",
        json!({"revision":1,"viewKey":f.view,"scope":f.scope,"toolId":"link"}),
    )?;
    let targets = call(
        &mut f.host,
        "views/targets",
        json!({"revision":1,"viewKey":f.view,"scope":f.scope,"toolId":"link","source":source}),
    )?;
    assert!(
        starts["symbols"]
            .as_array()
            .ok_or("No starts")?
            .contains(&source)
    );
    assert!(
        !targets["symbols"]
            .as_array()
            .ok_or("No targets")?
            .contains(&source)
    );
    let rejected = f.prepare(
        1,
        "link",
        json!({"name":"bad","source":source,"target":source}),
    )?;
    assert_eq!(rejected["code"], "edit.inapplicable");
    let prepared = f.prepare(1, "box", json!({"name":"AbortMe"}))?;
    call(
        &mut f.host,
        "views/abortCommand",
        json!({"token":prepared["token"]}),
    )?;
    assert!(f.commit(&prepared).is_err());
    let next = f.prepare(1, "box", json!({"name":"Next"}))?;
    assert_ne!(next["token"], prepared["token"]);
    call(
        &mut f.host,
        "workspace/analyze",
        json!({"revision":2,"sources":f.sources}),
    )?;
    assert!(f.commit(&next).is_err());
    assert!(
        f.prepare(1, "box", json!({"name":"Old"}))?["message"]
            .as_str()
            .is_some_and(|s| s.contains("stale"))
    );
    call(
        &mut f.host,
        "workspace/analyze",
        json!({"revision":3,"sources":[{"uri":"bad.harness","text":"space {"}]}),
    )?;
    assert!(
        f.prepare(3, "box", json!({"name":"Dirty"}))?["message"]
            .as_str()
            .is_some_and(|s| s.contains("clean"))
    );
    Ok(())
}
struct Untrusted;
impl Commands for Untrusted {
    fn supports(&self, _: &str) -> bool {
        true
    }
    fn prepare(
        &self,
        context: &CommandContext<'_>,
        command: &PrepareCommand,
    ) -> std::result::Result<Vec<SourcePatch>, CommandError> {
        let arg = |key: &str| command.arguments.get(key).map_or("", String::as_str);
        let uri = if arg("mode") == "document" {
            "notes.txt"
        } else {
            "structure.harness"
        };
        let text = context
            .sources
            .get(uri)
            .ok_or_else(|| CommandError::new("test", "No buffer"))?;
        let end = Position {
            line: text.bytes().filter(|b| *b == b'\n').count(),
            character: text
                .rsplit('\n')
                .next()
                .unwrap_or("")
                .encode_utf16()
                .count(),
        };
        let mut patch = source_patch(
            uri,
            text,
            Range {
                start: Position {
                    line: 0,
                    character: 0,
                },
                end,
            },
            arg("replacement").into(),
        )
        .map_err(|e| CommandError::new("test", e))?;
        if arg("mode") == "hash" {
            patch.after_hash = "0".repeat(64);
        }
        Ok(vec![patch])
    }
}
#[test]
fn candidate_validation_issues_map_directly_and_rejected_edits_change_nothing() -> Result {
    let mut f = Fixture::new(Box::new(Untrusted), false)?;
    let before = f.scene.clone();
    for (code, text) in [
        (
            "harness.link.ends",
            include_str!("../../../harness/models/invalid-same-ends.harness"),
        ),
        (
            "harness.end.target",
            include_str!("../../../harness/models/invalid-empty-end.harness"),
        ),
        (
            "harness.end.owner",
            include_str!("../../../harness/models/invalid-pin-owner.harness"),
        ),
        (
            "harness.names.unique",
            include_str!("../../../harness/models/invalid-duplicate-name.harness"),
        ),
    ] {
        let error = f.prepare(1, "box", json!({"replacement":text}))?;
        assert_eq!(error["code"], code, "{error}");
        assert!(error["feature"].is_string());
        assert!(error["elementKey"].is_string());
        f.refresh(1)?;
        assert_eq!(f.scene, before);
    }
    for mode in ["document", "hash"] {
        let error = f.prepare(
            1,
            "box",
            json!({"mode":mode,"replacement":"space Valid {}"}),
        )?;
        assert_eq!(error["code"], "edit.rejected");
        f.refresh(1)?;
        assert_eq!(f.scene, before);
    }
    assert_eq!(
        call(
            &mut f.host,
            "intersect/source",
            json!({"uri":"structure.harness"})
        )?["text"],
        f.sources[0]["text"]
    );
    Ok(())
}
#[test]
fn member_insertion_uses_lexical_anchors_and_preserves_crlf_and_utf16() -> Result {
    let text = "/*ðŸ˜€*/ box B { // }\r\n  field text = 1; /* } ; */\r\n}\r\n";
    let start = text.find("box").ok_or("No owner")?;
    let (range, replacement) = insert_member(text, (start, text.len()), "pin p : in;")?;
    let patch = source_patch("test.harness", text, range, replacement)?;
    assert_eq!(patch.range.start.line, 2);
    assert!(patch.replacement.contains("\r\n"));
    let (range, text) = insert_member("box B;", (0, 6), "box C {}")?;
    assert_eq!(range.start.character, 5);
    assert!(text.contains("box C {}"));
    assert!(insert_member("box B", (0, 5), "box C {}").is_err());
    Ok(())
}

#[test]
fn region_commands_and_focused_label_authorization() -> Result {
    let mut f = Fixture::new(Box::new(HarnessCommands), false)?;
    f.sources[0]["text"] = json!(
        include_str!("../../../harness/models/regions.harness")
            .replace(
                "field level = 2;",
                "/* 🧭 😀 */ field level /* name */ = /* keep */ 2;"
            )
            .replace("\n", "\r\n")
    );
    let doc = json!({"schemaVersion":1,"key":"regions","name":"Regions","ruleSet":"harness.regions","scope":{"schemaVersion":1,"ops":[]}});
    f.sources[1]["text"] = json!(doc.to_string());
    f.view = "regions".into();
    assert_eq!(
        call(
            &mut f.host,
            "workspace/analyze",
            json!({"revision":2,"sources":f.sources})
        )?["clean"],
        true
    );
    let catalog = call(&mut f.host, "views/catalog", json!({"revision":2}))?;
    let owners = catalog["views"][0]["owners"]
        .as_array()
        .ok_or("No owners")?;
    let ops = ["Alpha", "Beta"]
        .map(|name| {
            owners
                .iter()
                .find(|o| o["label"] == name)
                .map(|o| json!({"op":"addSeed","element":o["key"]}))
                .ok_or("No owner")
        })
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()?;
    f.scope = json!({"schemaVersion":1,"ops":ops});
    f.owner = ops[0]["element"].clone();
    f.refresh(2)?;
    let row = f.scene["scene"]["nodes"][0]["regions"]["items"][0]["children"][0]["compartments"][0]
        ["rows"][0]
        .clone();
    let part = row["label"]["parts"][2]["id"].clone();
    let request =
        json!({"revision":2,"viewKey":f.view,"scope":f.scope,"toolId":"field-value","part":part});
    assert_eq!(
        call(&mut f.host, "views/labelTargets", request.clone())?["enabled"],
        true
    );
    let mut wrong = request.clone();
    wrong["part"] = json!("forged");
    assert!(call(&mut f.host, "views/labelTargets", wrong).is_err());
    let mut wrong = request.clone();
    wrong["revision"] = json!(1);
    assert!(call(&mut f.host, "views/labelTargets", wrong).is_err());
    let mut literal = request.clone();
    literal["part"] = row["label"]["parts"][1]["id"].clone();
    assert_eq!(
        call(&mut f.host, "views/labelTargets", literal)?["enabled"],
        false
    );
    let args = json!({"part":part,"value":"9"});
    let denied = f.prepare(2, "field-value", args.clone())?;
    assert_eq!(denied["code"], "edit.rejected"); // Box is not the decorated Field.
    f.owner = row["binding"]["key"].clone();
    let bad = f.prepare(2, "field-value", json!({"part":part,"value":"-1"}))?;
    assert_eq!(bad["code"], "harness.command");
    let prepared = f.prepare(2, "field-value", args)?;
    assert!(prepared["token"].is_string(), "{prepared}");
    assert_eq!(prepared["patches"][0]["original"], "2");
    assert_eq!(prepared["patches"][0]["replacement"], "9");
    f.refresh(2)?;
    assert_eq!(
        f.scene["scene"]["nodes"][0]["regions"]["items"][0]["children"][0]["compartments"][0]["rows"]
            [0]["label"]["parts"][2]["text"],
        "low"
    );
    assert!(
        f.prepare(2, "field-value", json!({"part":part,"value":"9"}))?["code"] == "edit.pending"
    );
    f.apply(&prepared)?;
    assert!(
        f.sources[0]["text"]
            .as_str()
            .ok_or("No source")?
            .contains("/* 🧭 😀 */ field level /* name */ = /* keep */ 9;")
    );
    assert_eq!(f.commit(&prepared)?["clean"], true);
    f.refresh(3)?;
    for n in f.scene["scene"]["nodes"].as_array().ok_or("No roots")? {
        let value = &n["regions"]["items"][0]["children"][0]["compartments"][0]["rows"][0]["label"]
            ["parts"][2];
        assert_eq!(value["text"], "high");
    }
    assert_eq!(
        part,
        f.scene["scene"]["nodes"][0]["regions"]["items"][0]["children"][0]["compartments"][0]["rows"]
            [0]["label"]["parts"][2]["id"]
    );
    f.owner = f.scene["scene"]["nodes"][0]["binding"]["key"].clone();
    let group = f.prepare(3, "group", json!({"name":"Extra"}))?;
    assert!(group["token"].is_string(), "{group}");
    f.apply(&group)?;
    assert_eq!(f.commit(&group)?["clean"], true);
    f.refresh(4)?;
    assert_eq!(
        f.scene["scene"]["nodes"][0]["regions"]["items"]
            .as_array()
            .ok_or("No regions")?
            .len(),
        3
    );
    let a = f.scene["scene"]["nodes"][0]["regions"]["items"]
        .as_array()
        .ok_or("No regions")?;
    let left = a
        .iter()
        .find(|r| r["label"]["parts"][0]["text"] == "Left")
        .ok_or("No Left")?;
    let right = a
        .iter()
        .find(|r| r["label"]["parts"][0]["text"] == "Right")
        .ok_or("No Right")?;
    let args = json!({"name":"second","source":left["children"][0]["ports"][0]["id"],"target":right["children"][0]["ports"][0]["id"]});
    let link = f.prepare(4, "link", args)?;
    assert!(link["token"].is_string(), "{link}");
    assert!(
        link["patches"][0]["replacement"]
            .as_str()
            .ok_or("No patch")?
            .contains("group Left part Sender pin outPort")
    );
    Ok(())
}
