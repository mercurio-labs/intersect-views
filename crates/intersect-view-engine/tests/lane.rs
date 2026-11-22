use intersect_view_engine::{ElementId, EngineError, ViewFunctions, ViewModel, lane::*};
use intersect_views::*;
use serde_json::json;
use std::{cell::RefCell, collections::BTreeMap};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;
#[derive(Default)]
struct Fake {
    calls: RefCell<BTreeMap<(String, usize), usize>>,
    overrides: BTreeMap<(String, usize), Vec<usize>>,
}
impl Fake {
    fn set(&mut self, name: &str, owner: usize, values: &[usize]) {
        self.overrides.insert((name.into(), owner), values.to_vec());
    }
}
impl ViewModel for Fake {
    fn element(&self, key: &str) -> Option<ElementId> {
        key.strip_prefix("e:")?.parse().ok().map(ElementId::new)
    }
    fn key(&self, e: ElementId) -> Result<String, EngineError> {
        Ok(format!("e:{}", e.index()))
    }
    fn is_a(&self, e: ElementId, _: &str) -> Result<bool, EngineError> {
        Ok([0, 9].contains(&e.index()))
    }
    fn class_is_a(&self, a: &str, b: &str) -> Result<bool, EngineError> {
        Ok(a == b)
    }
    fn binding(&self, e: ElementId, context: &[String]) -> Result<Binding, EngineError> {
        Ok(Binding {
            key: self.key(e)?,
            element_id: self.key(e)?,
            context: context.to_vec(),
            uri: "memory:/lane".into(),
            read_only: false,
            range: Range {
                start: Position {
                    line: 0,
                    character: 0,
                },
                end: Position {
                    line: 0,
                    character: 1,
                },
            },
        })
    }
}
impl ViewFunctions for Fake {
    fn elements(&self, name: &str, owner: ElementId) -> Result<Vec<ElementId>, EngineError> {
        let key = (name.to_owned(), owner.index());
        *self.calls.borrow_mut().entry(key.clone()).or_default() += 1;
        let values =
            self.overrides
                .get(&key)
                .cloned()
                .unwrap_or_else(|| match (name, owner.index()) {
                    ("lanes", 0 | 9) => vec![1, 2, 3],
                    ("steps", 0 | 9) => vec![4, 5, 6, 7],
                    ("lane", 4 | 5 | 7) => vec![1],
                    ("lane", 6) => vec![2],
                    ("after", 5) => vec![4, 4],
                    ("after", 6) => vec![4],
                    ("after", 7) => vec![6],
                    ("end", 5) => vec![7],
                    ("across", 5) => vec![2, 2],
                    _ => vec![],
                });
        Ok(values.into_iter().map(ElementId::new).collect())
    }
    fn boolean(&self, _: &str, _: ElementId) -> Result<bool, EngineError> {
        Ok(true)
    }
    fn string(&self, name: &str, e: ElementId) -> Result<String, EngineError> {
        *self
            .calls
            .borrow_mut()
            .entry((name.into(), e.index()))
            .or_default() += 1;
        self.key(e)
    }
}
fn rules(direction: &str) -> TestResult<LaneGraphRuleSet> {
    Ok(serde_json::from_value(
        json!({"schemaVersion":RULE_VERSION,"projection":{"kind":"nested"},"id":"test.lanes",
        "label":"Lanes","language":"urn:fake","form":"laneGraph","laneGraph":{
        "container":{"match":"Container","lanes":"lanes","steps":"steps"},
        "lane":{"id":"lane","label":"label"},
        "step":{"id":"step","label":"label","lane":"lane","after":"after","end":"end","across":"across"},
        "axis":{"direction":direction,"semantic":true}}}),
    )?)
}
fn run(
    f: &Fake,
    direction: &str,
    ops: Vec<ScopeOp>,
    limits: LaneLimits,
) -> TestResult<LaneGraphScene> {
    let view = View {
        key: "view".into(),
        name: "Process".into(),
        kind: "test.lanes".into(),
        binding: f.binding(ElementId::new(0), &[])?,
        owners: vec![],
        details: vec![],
        problems: vec![],
    };
    let palette: Palette =
        serde_json::from_value(json!({"schemaVersion":1,"id":"test","label":"Test","groups":[]}))?;
    Ok(evaluate(
        &rules(direction)?,
        &Scope {
            schema_version: 1,
            ops,
        },
        view,
        palette,
        1,
        f,
        f,
        limits,
    )?)
}
fn seed(n: usize) -> ScopeOp {
    ScopeOp::AddSeed {
        element: format!("e:{n}"),
    }
}

#[test]
fn deterministic_ranks_bindings_unordered_ties_empty_lane_and_spans() -> TestResult {
    let f = Fake::default();
    let a = run(
        &f,
        "horizontal",
        vec![seed(0), seed(0)],
        LaneLimits::default(),
    )?;
    assert_eq!(a.lanes.len(), 3);
    assert_eq!(
        a.steps.iter().map(|s| s.rank).collect::<Vec<_>>(),
        [0, 1, 2, 3]
    );
    assert_eq!(
        a.steps.iter().map(|s| s.unordered).collect::<Vec<_>>(),
        [false, true, true, false]
    );
    assert_eq!(a.steps[1].predecessors, [a.steps[0].id.clone()]);
    assert_eq!(a.spans.len(), 1);
    assert_eq!(
        a.spans[0].lanes,
        [a.lanes[0].id.clone(), a.lanes[1].id.clone()]
    );
    assert!(a.steps.iter().all(|s| s.binding.context == ["e:0"]));
    assert_eq!(f.calls.borrow().get(&("lanes".into(), 0)), Some(&1));
    for name in ["lane", "after", "end", "across"] {
        for step in 4..=7 {
            assert_eq!(f.calls.borrow().get(&(name.into(), step)), Some(&1));
        }
    }
    let b = run(
        &Fake::default(),
        "horizontal",
        vec![seed(0)],
        LaneLimits::default(),
    )?;
    assert_eq!(serde_json::to_vec(&a)?, serde_json::to_vec(&b)?);
    let vertical = run(
        &Fake::default(),
        "vertical",
        vec![seed(0)],
        LaneLimits::default(),
    )?;
    assert_eq!(a.order, vertical.order);
    assert_eq!(a.lanes[0].id, vertical.lanes[0].id);
    Ok(())
}

#[test]
fn each_finite_evaluation_limit_fails_by_name() {
    let limits = [
        (
            LaneLimits {
                containers: 0,
                ..Default::default()
            },
            "containers",
        ),
        (
            LaneLimits {
                lanes: 2,
                ..Default::default()
            },
            "lanes",
        ),
        (
            LaneLimits {
                steps: 3,
                ..Default::default()
            },
            "steps",
        ),
        (
            LaneLimits {
                spans: 0,
                ..Default::default()
            },
            "spans",
        ),
        (
            LaneLimits {
                arcs: 2,
                ..Default::default()
            },
            "arcs",
        ),
        (
            LaneLimits {
                work: 0,
                ..Default::default()
            },
            "work",
        ),
        (
            LaneLimits {
                parts: 0,
                ..Default::default()
            },
            "parts",
        ),
    ];
    for (limit, name) in limits {
        let error = run(&Fake::default(), "horizontal", vec![seed(0)], limit).err();
        assert!(
            error.is_some_and(|e| e.to_string().contains(name)),
            "{name}"
        );
    }
}

#[test]
fn off_container_or_missing_references_cycles_and_partial_spans_fail() {
    let variants = [
        ("lane", 4, vec![]),
        ("lane", 4, vec![1, 1]),
        ("lane", 4, vec![8]),
        ("after", 4, vec![7]),
        ("after", 4, vec![8]),
        ("end", 5, vec![5]),
        ("end", 5, vec![4]),
        ("end", 5, vec![8]),
        ("end", 5, vec![6, 7]),
        ("across", 5, vec![3]),
        ("across", 5, vec![8]),
    ];
    for (name, owner, values) in variants {
        let mut fake = Fake::default();
        fake.set(name, owner, &values);
        assert!(
            run(&fake, "horizontal", vec![seed(0)], LaneLimits::default()).is_err(),
            "{name}/{owner}/{values:?}"
        );
    }
    assert!(
        run(
            &Fake::default(),
            "horizontal",
            vec![seed(0), seed(9)],
            LaneLimits::default()
        )
        .is_err()
    );
    assert!(
        run(
            &Fake::default(),
            "horizontal",
            vec![seed(4)],
            LaneLimits::default()
        )
        .is_err()
    );
}

#[test]
fn visible_foreign_container_references_are_rejected() {
    for (name, owner, values) in [
        ("lane", 4, vec![10]),
        ("after", 4, vec![12]),
        ("end", 5, vec![13]),
        ("across", 5, vec![10]),
    ] {
        let mut fake = Fake::default();
        fake.set("lanes", 9, &[10, 11]);
        fake.set("steps", 9, &[12, 13]);
        fake.set("lane", 12, &[10]);
        fake.set("lane", 13, &[11]);
        fake.set(name, owner, &values);
        assert!(
            run(
                &fake,
                "horizontal",
                vec![seed(0), seed(9)],
                LaneLimits::default()
            )
            .is_err(),
            "{name}"
        );
    }
}

#[test]
fn ordered_container_scope_ops_and_unsupported_exploration_are_explicit() -> TestResult {
    let scene = run(
        &Fake::default(),
        "horizontal",
        vec![
            seed(9),
            ScopeOp::Hide {
                element: "e:9".into(),
            },
            seed(0),
            ScopeOp::RemoveSeed {
                element: "e:0".into(),
            },
            seed(0),
        ],
        LaneLimits::default(),
    )?;
    assert_eq!(scene.steps.len(), 4);
    let ops = [
        ScopeOp::Expand {
            element: "e:0".into(),
            relation: "anything".into(),
            hops: 1,
        },
        ScopeOp::Collapse {
            element: "e:0".into(),
            context: vec![],
        },
    ];
    for op in ops {
        assert!(
            run(
                &Fake::default(),
                "horizontal",
                vec![op],
                LaneLimits::default()
            )
            .is_err()
        );
    }
    assert!(
        run(
            &Fake::default(),
            "horizontal",
            vec![],
            LaneLimits::default()
        )?
        .steps
        .is_empty()
    );
    Ok(())
}
