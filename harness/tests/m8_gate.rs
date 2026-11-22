use intersect_view_harness::{Source, load, with_definition};
#[test]
fn group_part_pin_linking_gate() -> Result<(), String> {
    with_definition(|d| {
        let l = load(
            d,
            &[Source {
                uri: "regions.harness".into(),
                text: include_str!("../models/regions.harness").into(),
            }],
        )?;
        if !l.issues.is_empty() {
            return Err(format!(
                "Group gate: {:?}; unresolved={}, proxies={}",
                l.issues, l.unresolved_occurrences, l.proxies
            ));
        }
        let ends = l
            .model
            .objects()
            .filter(|o| o.class_key() == "End")
            .collect::<Vec<_>>();
        assert_eq!(ends.len(), 2);
        for end in ends {
            for feature in ["group", "part", "pin"] {
                let f = end.feature(feature).ok_or("Missing feature")?;
                assert_eq!(end.refs(f).count(), 1);
            }
        }
        Ok(())
    })
}

#[test]
fn group_loader_diagnostics() -> Result<(), String> {
    let mut host = intersect_view_host::Host::new(
        intersect_view_harness::definition(),
        Box::new(intersect_view_host::NoCommands),
    )?;
    let result=host.dispatch(serde_json::json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"regions.harness","text":include_str!("../models/regions.harness")}]}}))?;
    assert_eq!(result["clean"], true);
    assert_eq!(result["references"], 8);
    assert_eq!(result["resolved"], 8);
    Ok(())
}
#[test]
fn actual_host_regions_and_separate_labels() -> Result<(), String> {
    intersect_view_harness::probe::regions().map(|_| ())
}

#[test]
fn invalid_group_prefix_has_one_located_issue() -> Result<(), String> {
    with_definition(|d| {
        let l = load(
            d,
            &[Source {
                uri: "invalid-group.harness".into(),
                text: include_str!("../models/invalid-group.harness").into(),
            }],
        )?;
        assert_eq!(l.issues.len(), 1, "{:?}", l.issues);
        assert_eq!(l.issues[0].issue.code, "harness.end.group");
        Ok(())
    })
}
