use intersect_model::definitions::bundle::{DefinitionSource, SourceKind};
use intersect_view_host::{Host, LanguageDefinition, NoCommands};
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn host() -> Result<Host> {
    Ok(Host::new(
        intersect_view_harness::definition(),
        Box::new(NoCommands),
    )?)
}
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    Ok(host.dispatch(json!({"method":method,"params":params}))?)
}
fn analyze(host: &mut Host, text: &str, revision: u64) -> Result<Value> {
    call(
        host,
        "workspace/analyze",
        json!({"revision":revision,"sources":[{"uri":"main.harness","text":text}]}),
    )
}
fn node<'a>(value: &'a Value, name: &str) -> Result<&'a Value> {
    value["nodes"]
        .as_array()
        .ok_or("Missing nodes")?
        .iter()
        .find(|v| v["name"] == name)
        .ok_or_else(|| format!("Missing node {name}").into())
}
fn position(text: &str, byte: usize) -> Value {
    let prefix = &text[..byte];
    let start = prefix.rfind('\n').map_or(0, |i| i + 1);
    json!({"line":prefix.bytes().filter(|b|*b==b'\n').count(),"character":prefix[start..].encode_utf16().count()})
}

#[test]
fn initialize_clean_analysis_inspect_source_and_locate() -> Result {
    let mut host = host()?;
    let init = call(&mut host, "initialize", json!({"protocolVersion":2}))?;
    assert_eq!(init["protocolVersion"], 2);
    assert_eq!(
        init["capabilities"]["sceneVersion"],
        intersect_views::VERSION
    );
    assert_eq!(
        init["capabilities"]["presentationVersion"],
        intersect_views::PRESENTATION_VERSION
    );
    assert_eq!(init["language"]["id"], "harness");
    assert_eq!(init["language"]["fileExtensions"], json!(["harness"]));
    assert_eq!(init["capabilities"]["positionEncoding"], "utf-16");
    let text = include_str!("../../../harness/models/structure.harness");
    let analysis = analyze(&mut host, text, 7)?;
    assert_eq!(analysis["clean"], true);
    assert_eq!(analysis["hasModel"], true);
    assert_eq!(analysis["references"], 9);
    assert_eq!(analysis["resolved"], 9);
    assert_eq!(analysis["diagnostics"], json!([]));
    let alpha = node(&analysis, "Alpha")?;
    let shared = node(&analysis, "Shared")?;
    let inspected = call(
        &mut host,
        "intersect/inspect",
        json!({"id":alpha["id"],"revision":7}),
    )?;
    assert_eq!(inspected["revision"], 7);
    assert_eq!(inspected["values"]["name"], "Alpha");
    assert_eq!(inspected["values"]["kind"]["$ref"], shared["id"]);
    assert_eq!(
        call(&mut host, "intersect/source", json!({"uri":"main.harness"}))?,
        json!({"uri":"main.harness","text":text})
    );
    let located = call(
        &mut host,
        "views/locate",
        json!({"revision":7,"uri":"main.harness","position":position(text,text.find("Alpha").ok_or("No Alpha")?)}),
    )?;
    assert_eq!(located["elementId"], alpha["id"]);
    assert!(
        located["key"]
            .as_str()
            .ok_or("Missing key")?
            .starts_with("element:")
    );
    // Exact authored reference navigation must use the linked target.
    let located = call(
        &mut host,
        "views/locate",
        json!({"revision":7,"uri":"main.harness","position":position(text,text.find(": Shared").ok_or("No kind reference")?+2)}),
    )?;
    assert_eq!(located["elementId"], shared["id"]);
    Ok(())
}
#[test]
fn parse_and_validation_diagnostics_use_utf16_and_gate_publication() -> Result {
    let mut host = host()?;
    let good = analyze(&mut host, "space S { box Old {} }", 1)?;
    let old = node(&good, "Old")?["id"].clone();
    let text = "/*😀 café*/ space S { box B { field repeated = 1; field repeated = 2; } }";
    let result = analyze(&mut host, text, 2)?;
    assert_eq!(result["clean"], false);
    assert_eq!(result["hasModel"], true);
    assert_eq!(result["nodes"], json!([]));
    let diagnostics = result["diagnostics"]
        .as_array()
        .ok_or("Missing diagnostics")?;
    assert_eq!(diagnostics.len(), 1);
    let diagnostic = &diagnostics[0];
    assert_eq!(diagnostic["phase"], "check");
    assert_eq!(diagnostic["code"], "harness.names.unique");
    assert_eq!(diagnostic["feature"], "name");
    assert_eq!(diagnostic["severity"], "error");
    assert_eq!(diagnostic["uri"], "main.harness");
    assert_eq!(
        diagnostic["range"]["start"],
        position(text, text.find("box").ok_or("No box")?)
    );
    assert!(
        host.dispatch(json!({"method":"intersect/inspect","params":{"id":old,"revision":2}}))
            .is_err()
    );
    let bad = "/*😀*/ space S { box B { field f = ; } }";
    let result = analyze(&mut host, bad, 3)?;
    assert_eq!(result["clean"], false);
    let diagnostic = result["diagnostics"]
        .as_array()
        .ok_or("Missing parse diagnostics")?
        .iter()
        .find(|d| d["phase"] == "parse")
        .ok_or("No parse diagnostic")?;
    assert_eq!(
        diagnostic["range"]["start"],
        position(bad, bad.find(';').ok_or("No error token")?)
    );
    assert_eq!(
        call(
            &mut host,
            "intersect/source",
            json!({"uri":"main.harness","revision":3})
        )?["text"],
        bad
    );
    assert!(
        host.dispatch(json!({"method":"intersect/inspect","params":{"id":old,"revision":3}}))
            .is_err()
    );
    assert_eq!(
        analyze(&mut host, "space S { box Recovered {} }", 4)?["clean"],
        true
    );
    Ok(())
}
#[test]
fn linking_errors_are_diagnostics_and_do_not_leave_old_models() -> Result {
    let mut host = host()?;
    let old = analyze(&mut host, "space S { box Old {} }", 1)?;
    let result = analyze(&mut host, "space S { box A -> Missing {} }", 2)?;
    assert_eq!(result["clean"], false);
    assert!(
        result["diagnostics"]
            .as_array()
            .ok_or("Missing diagnostics")?
            .iter()
            .any(|d| d["phase"] == "link" && d["uri"] == "main.harness")
    );
    assert!(
        host.dispatch(
            json!({"method":"intersect/inspect","params":{"id":node(&old,"Old")?["id"]}})
        )
        .is_err()
    );
    Ok(())
}
#[test]
fn stale_requests_bad_positions_and_unsupported_methods_fail() -> Result {
    let mut host = host()?;
    let analysis = analyze(&mut host, "/*😀*/ space S { box B {} }", 10)?;
    for (method, params) in [
        (
            "intersect/inspect",
            json!({"revision":9,"id":node(&analysis,"B")?["id"]}),
        ),
        (
            "intersect/source",
            json!({"revision":11,"uri":"main.harness"}),
        ),
        (
            "views/locate",
            json!({"revision":9,"uri":"main.harness","position":{"line":0,"character":0}}),
        ),
    ] {
        let error = host
            .dispatch(json!({"method":method,"params":params}))
            .err()
            .ok_or("Expected stale request")?;
        assert!(error.contains("stale"), "{error}");
    }
    for pos in [
        json!({"line":0,"character":3}),
        json!({"line":0,"character":999}),
        json!({"line":2,"character":0}),
        json!({"line":-1,"character":0}),
    ] {
        assert!(host.dispatch(json!({"method":"views/locate","params":{"revision":10,"uri":"main.harness","position":pos}})).is_err());
    }
    for method in [
        "textDocument/hover",
        "textDocument/completion",
        "evaluation/sites",
        "evaluation/evaluate",
        "unknown",
    ] {
        assert_eq!(
            host.dispatch(json!({"method":method,"params":{}}))
                .err()
                .ok_or("Expected unsupported method")?,
            format!("Unsupported language method: {method}")
        );
    }
    call(&mut host, "shutdown", json!({}))?;
    assert!(
        host.dispatch(
            json!({"method":"intersect/inspect","params":{"id":node(&analysis,"B")?["id"]}})
        )
        .is_err()
    );
    Ok(())
}
#[test]
fn named_keys_survive_unrelated_insertions() -> Result {
    let mut host = host()?;
    let before = "space S { box Stable { field f = 1; } }";
    let after = "space S { box Unrelated {} box Stable { field f = 1; } }";
    analyze(&mut host, before, 1)?;
    let first = call(
        &mut host,
        "views/locate",
        json!({"revision":1,"uri":"main.harness","position":position(before,before.find("Stable").ok_or("No Stable")?)}),
    )?;
    analyze(&mut host, after, 2)?;
    let second = call(
        &mut host,
        "views/locate",
        json!({"revision":2,"uri":"main.harness","position":position(after,after.find("Stable").ok_or("No Stable")?)}),
    )?;
    assert_eq!(first["key"], second["key"]);
    Ok(())
}
#[test]
fn project_documents_are_retained_but_never_parsed_as_language_text() -> Result {
    let mut host = host()?;
    let result = call(
        &mut host,
        "workspace/analyze",
        json!({"revision":1,"projectNodesOnly":true,"sources":[{"uri":"model.harness","text":"space S {}"},{"uri":"diagram.view.json","text":"Not harness syntax, nor JSON"}]}),
    )?;
    assert_eq!(result["clean"], true);
    assert_eq!(result["nodes"].as_array().ok_or("Missing nodes")?.len(), 1);
    assert_eq!(
        call(
            &mut host,
            "intersect/source",
            json!({"uri":"diagram.view.json"})
        )?["text"],
        "Not harness syntax, nor JSON"
    );
    for field in ["descriptor", "archives"] {
        let mut params = json!({"revision":2,"sources":[]});
        params[field] = Value::Null;
        assert!(
            host.dispatch(json!({"method":"workspace/analyze","params":params}))
                .is_err()
        );
    }
    Ok(())
}
#[test]
fn transport_limits_duplicate_uris_and_safe_revisions_are_enforced() -> Result {
    let mut host = host()?;
    let models: Vec<_> = (0..256)
        .map(|i| json!({"uri":format!("{i}.harness"),"text":format!("space S{i} {{}} ")}))
        .collect();
    let result = call(
        &mut host,
        "workspace/analyze",
        json!({"revision":0,"sources":models}),
    )?;
    assert_eq!(result["clean"], true);
    assert_eq!(
        result["nodes"]
            .as_array()
            .ok_or("Missing model nodes")?
            .len(),
        256
    );
    let docs: Vec<_> = (0..256)
        .map(|i| json!({"uri":format!("{i}.json"),"text":""}))
        .collect();
    assert_eq!(
        call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":docs})
        )?["clean"],
        true
    );
    let too_many: Vec<_> = (0..257)
        .map(|i| json!({"uri":format!("{i}.json"),"text":""}))
        .collect();
    assert!(
        host.dispatch(
            json!({"method":"workspace/analyze","params":{"revision":2,"sources":too_many}})
        )
        .err()
        .ok_or("Expected limit")?
        .contains("256")
    );
    let exact = "💡".repeat(2 * 1024 * 1024);
    assert_eq!(
        call(
            &mut host,
            "workspace/analyze",
            json!({"revision":3,"sources":[{"uri":"large.json","text":exact}]})
        )?["clean"],
        true
    );
    let large = "x".repeat(8 * 1024 * 1024 + 1);
    assert!(host.dispatch(json!({"method":"workspace/analyze","params":{"revision":4,"sources":[{"uri":"large.harness","text":large}]}})).err().ok_or("Expected byte limit")?.contains("8 MiB"));
    assert!(host.dispatch(json!({"method":"workspace/analyze","params":{"revision":5,"sources":[{"uri":"same.harness","text":"space A {}"},{"uri":"same.harness","text":"space B {}"}]}})).err().ok_or("Expected duplicates")?.contains("Duplicate"));
    assert!(host.dispatch(json!({"method":"workspace/analyze","params":{"revision":9007199254740992u64,"sources":[]}})).err().ok_or("Expected revision limit")?.contains("portable"));
    Ok(())
}
fn mini(named: bool, ecore: bool) -> LanguageDefinition {
    let mut structure = if ecore {
        DefinitionSource::new(
            "mini.ecore",
            SourceKind::Ecore,
            r##"<?xml version="1.0"?><ecore:EPackage xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ecore="http://www.eclipse.org/emf/2002/Ecore" name="mini" nsURI="urn:mini:1" nsPrefix="m"><eClassifiers xsi:type="ecore:EClass" name="Root"><eStructuralFeatures xsi:type="ecore:EAttribute" name="label" lowerBound="1" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/><eStructuralFeatures xsi:type="ecore:EReference" name="notes" upperBound="-1" containment="true" eType="#//Note"/></eClassifiers><eClassifiers xsi:type="ecore:EClass" name="Note"><eStructuralFeatures xsi:type="ecore:EAttribute" name="text" lowerBound="1" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString"/></eClassifiers></ecore:EPackage>"##,
        )
    } else {
        DefinitionSource::new(
            "mini.rcore",
            SourceKind::Rcore,
            r#"rcore 1;package mini version "1";metamodel "urn:mini:1" prefix m {class Root {attr label:String [1,1];ref notes:Note [0,*] containment;}class Note {attr text:String [1,1];}}"#,
        )
    };
    let mut grammar = r#"grammar org.intersect.Mini with org.eclipse.xtext.common.Terminals
import "urn:mini:1" as m
Root returns m::Root: 'root' label=ID '{' notes+=Note* '}';
Note returns m::Note: 'note' text=STRING ';';"#
        .to_owned();
    if named {
        structure = DefinitionSource::new(
            structure.id.uri.clone(),
            structure.kind,
            structure
                .text
                .replace("name=\"text\"", "name=\"label\"")
                .replace("attr text:", "attr label:"),
        );
        grammar = grammar.replace("text=STRING", "label=STRING");
    }
    LanguageDefinition {
        id: "mini".into(),
        name: "Mini".into(),
        namespace: "urn:mini:1".into(),
        file_extensions: vec!["mini".into()],
        structure,
        grammar: DefinitionSource::new("mini.xtext", SourceKind::Xtext, grammar),
        bindings: DefinitionSource::new(
            "mini-bindings.rcore",
            SourceKind::RcoreBehavior,
            "rcore 1;package mini.bindings version \"1\";",
        ),
        view_functions: vec![],
        extra_functions: vec![],
        view_execution_limits: Default::default(),
        view_function_work: 2_000_000,
        rule_sets: vec![],
        notation: String::new(),
        palette: String::new(),
        name_features: vec!["missing".into(), "label".into()],
    }
}
#[test]
fn generic_rcore_and_ecore_languages_use_configured_names_and_anonymous_keys() -> Result {
    for ecore in [false, true] {
        let mut host = Host::new(mini(false, ecore), Box::new(NoCommands))?;
        let text = "root Custom { note \"café😀\"; }";
        let result = call(
            &mut host,
            "workspace/analyze",
            json!({"revision":1,"sources":[{"uri":"custom.mini","text":text}]}),
        )?;
        assert_eq!(result["clean"], true);
        assert_eq!(node(&result, "Custom")?["name"], "Custom");
        let located = call(
            &mut host,
            "views/locate",
            json!({"revision":1,"uri":"custom.mini","position":position(text,text.find("note").ok_or("No note")?)}),
        )?;
        assert!(
            located["key"]
                .as_str()
                .ok_or("No anonymous key")?
                .starts_with("anonymous:")
        );
        let inspected = call(
            &mut host,
            "intersect/inspect",
            json!({"id":located["elementId"]}),
        )?;
        assert_eq!(inspected["values"]["text"], "café😀");
        assert_eq!(
            inspected["range"]["end"],
            position(text, text.find(';').ok_or("No semicolon")? + 1)
        );
    }
    Ok(())
}
#[test]
fn ambiguous_named_paths_are_rejected_before_publication() -> Result {
    let mut host = Host::new(mini(true, false), Box::new(NoCommands))?;
    let bad = "root Custom { note \"Repeated\"; note \"Repeated\"; }";
    let error=host.dispatch(json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"custom.mini","text":bad}]}})).err().ok_or("Expected ambiguity")?;
    assert!(error.contains("Ambiguous"), "{error}");
    Ok(())
}

#[test]
fn languages_without_name_features_have_anonymous_keys() -> Result {
    let mut definition = mini(false, false);
    definition.name_features.clear();
    let mut host = Host::new(definition, Box::new(NoCommands))?;
    let result = call(
        &mut host,
        "workspace/analyze",
        json!({"revision":1,"sources":[{"uri":"custom.mini","text":"root Custom {}"}]}),
    )?;
    assert_eq!(result["clean"], true);
    assert_eq!(result["nodes"], json!([]));
    let located = call(
        &mut host,
        "views/locate",
        json!({"revision":1,"uri":"custom.mini","position":{"line":0,"character":5}}),
    )?;
    assert!(
        located["key"]
            .as_str()
            .ok_or("Missing anonymous key")?
            .starts_with("anonymous:")
    );
    Ok(())
}

#[test]
fn equal_source_ranges_prefer_named_declarations_over_anonymous_wrappers() -> Result {
    let mut definition = mini(true, false);
    definition.structure = DefinitionSource::new(
        "wrapped.rcore",
        SourceKind::Rcore,
        r#"rcore 1; package mini version "1"; metamodel "urn:mini:1" prefix m {
          class Root { attr label:String [1,1]; ref wrappers:Wrapper [0,*] containment; }
          class Wrapper { ref note:Note [1,1] containment; }
          class Note { attr label:String [1,1]; }
        }"#,
    );
    definition.grammar = DefinitionSource::new(
        "wrapped.xtext",
        SourceKind::Xtext,
        r#"grammar org.intersect.Wrapped with org.eclipse.xtext.common.Terminals
import "urn:mini:1" as m
Root returns m::Root: 'root' label=ID '{' wrappers+=Wrapper* '}';
Wrapper returns m::Wrapper: note=Note;
Note returns m::Note: 'note' label=STRING ';';"#,
    );
    let mut host = Host::new(definition, Box::new(NoCommands))?;
    let text = r#"/*😀*/ root Owner { note "camera"; }"#;
    let analysis = call(
        &mut host,
        "workspace/analyze",
        json!({
            "revision":1,"sources":[{"uri":"wrapped.mini","text":text}]
        }),
    )?;
    assert_eq!(analysis["clean"], true, "{analysis}");
    let expected = node(&analysis, "camera")?["id"].clone();
    {
        let model = host.accepted_model().ok_or("No model")?;
        let wrapper = model
            .objects()
            .find(|o| o.feature("note").is_some())
            .ok_or("No wrapper")?;
        let subject = model
            .lookup(expected.as_str().ok_or("No subject id")?)
            .ok_or("No subject")?;
        assert_eq!(
            wrapper.span(),
            subject.span(),
            "fixture must exercise an exact range tie"
        );
    }
    let start = text.find("note").ok_or("No note")?;
    let end = text.find(';').ok_or("No semicolon")?;
    for offset in start..=end {
        let located = call(
            &mut host,
            "views/locate",
            json!({
                "revision":1,"uri":"wrapped.mini","position":position(text,offset)
            }),
        )?;
        assert_eq!(located["elementId"], expected, "at byte {offset}");
        assert!(
            located["key"]
                .as_str()
                .ok_or("No key")?
                .starts_with("element:")
        );
    }
    Ok(())
}

#[test]
fn oversized_wasm_allocation_cannot_replay_the_previous_request() -> Result {
    use intersect_view_host::WasmTransport;
    fn response(transport: &mut WasmTransport) -> Result<Value> {
        let length = transport.execute(|| Host::new(mini(true, false), Box::new(NoCommands)));
        // The transport owns the returned bytes until its next mutable call.
        let bytes = unsafe { std::slice::from_raw_parts(transport.output_buffer(), length) };
        Ok(serde_json::from_slice(bytes)?)
    }
    fn input(transport: &mut WasmTransport, bytes: &[u8]) {
        let pointer = transport.input_buffer(bytes.len());
        assert!(!pointer.is_null());
        // input_buffer allocated this exact writable extent.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len()) };
    }
    let mut transport = WasmTransport::new();
    let initialize = br#"{"method":"initialize","params":{"protocolVersion":2}}"#;
    input(&mut transport, initialize);
    assert_eq!(response(&mut transport)?["protocolVersion"], 2);
    assert!(transport.input_buffer(16 * 1024 * 1024 + 1).is_null());
    let refused = response(&mut transport)?;
    assert!(
        refused["error"].is_string(),
        "old request replayed: {refused}"
    );
    input(&mut transport, initialize);
    assert_eq!(response(&mut transport)?["protocolVersion"], 2);
    Ok(())
}
