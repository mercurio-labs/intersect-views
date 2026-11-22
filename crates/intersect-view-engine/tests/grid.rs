use intersect_view_engine::{ElementId, EngineError, ViewFunctions, ViewModel, grid::*};
use intersect_views::*;
use serde_json::{Value, json};
use std::{cell::RefCell, collections::BTreeMap};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
struct Fake {
    calls: RefCell<BTreeMap<String, usize>>,
    inconsistent: bool,
    off_axis: bool,
    duplicate: bool,
}
impl Fake {
    fn new() -> Self {
        Self {
            calls: RefCell::new(BTreeMap::new()),
            inconsistent: false,
            off_axis: false,
            duplicate: false,
        }
    }
}
impl ViewModel for Fake {
    fn element(&self, key: &str) -> Option<ElementId> {
        key.strip_prefix("e:")?
            .parse::<usize>()
            .ok()
            .filter(|n| *n < 10_000)
            .map(ElementId::new)
    }
    fn key(&self, id: ElementId) -> std::result::Result<String, EngineError> {
        Ok(format!("e:{}", id.index()))
    }
    fn is_a(&self, _: ElementId, _: &str) -> std::result::Result<bool, EngineError> {
        Ok(true)
    }
    fn class_is_a(&self, _: &str, _: &str) -> std::result::Result<bool, EngineError> {
        Ok(true)
    }
    fn binding(&self, id: ElementId, _: &[String]) -> std::result::Result<Binding, EngineError> {
        serde_json::from_value(json!({"key":self.key(id)?,"elementId":self.key(id)?,"context":[],"uri":"fake","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}},"readOnly":false})).map_err(|e|EngineError(e.to_string()))
    }
}
impl ViewFunctions for Fake {
    fn elements(
        &self,
        name: &str,
        id: ElementId,
    ) -> std::result::Result<Vec<ElementId>, EngineError> {
        *self.calls.borrow_mut().entry(name.into()).or_default() += 1;
        let values = match (name, id.index()) {
            ("traceTargets", 0) if !self.inconsistent => {
                if self.off_axis {
                    vec![1, 7]
                } else {
                    vec![1, 1]
                }
            }
            ("outgoingTraces", 0) => {
                if self.duplicate {
                    vec![3, 3, 4]
                } else {
                    vec![3, 4]
                }
            }
            ("traceTarget", 3 | 4) => vec![1],
            _ => vec![],
        };
        Ok(values.into_iter().map(ElementId::new).collect())
    }
    fn boolean(&self, _: &str, _: ElementId) -> std::result::Result<bool, EngineError> {
        Ok(true)
    }
    fn string(&self, _: &str, id: ElementId) -> std::result::Result<String, EngineError> {
        *self.calls.borrow_mut().entry("label".into()).or_default() += 1;
        self.key(id)
    }
}
impl GridQueries for Fake {
    fn query(
        &self,
        role: &str,
        candidates: &[ElementId],
        _: usize,
    ) -> std::result::Result<QueryTable, EngineError> {
        *self.calls.borrow_mut().entry(role.into()).or_default() += 1;
        let columns = if role == "table" {
            vec![
                QueryColumn {
                    name: "name".into(),
                    scalar: GridScalar::String,
                    many: false,
                },
                QueryColumn {
                    name: "kind".into(),
                    scalar: GridScalar::String,
                    many: false,
                },
                QueryColumn {
                    name: "fields".into(),
                    scalar: GridScalar::Integer,
                    many: false,
                },
            ]
        } else {
            vec![QueryColumn {
                name: "name".into(),
                scalar: GridScalar::String,
                many: false,
            }]
        };
        let rows = candidates
            .iter()
            .map(|id| {
                let mut values = BTreeMap::from([
                    (
                        "name".into(),
                        Some(GridValue::String {
                            value: format!("Label {}", id.index()),
                        }),
                    ),
                    ("kind".into(), None),
                    (
                        "fields".into(),
                        Some(GridValue::Integer { value: "0".into() }),
                    ),
                ]);
                if role == "table" && id.index() == 0 {
                    values.insert(
                        "kind".into(),
                        Some(GridValue::String {
                            value: String::new(),
                        }),
                    );
                }
                QueryRow {
                    element: *id,
                    values,
                }
            })
            .collect();
        Ok(QueryTable { rows, columns })
    }
}
fn run(f: &Fake, r: &GridRuleSet, ops: Value, limits: GridLimits) -> Result<GridScene> {
    let s: Scene = serde_json::from_str(include_str!(
        "../../intersect-views/tests/fixtures/scene-v6-m14.json"
    ))?;
    Ok(evaluate(
        r,
        &serde_json::from_value(ops)?,
        s.view().clone(),
        s.palette().clone(),
        1,
        f,
        f,
        f,
        limits,
    )?)
}
fn scope(ids: &[usize]) -> Value {
    json!({"schemaVersion":1,"ops":ids.iter().map(|i|json!({"op":"addSeed","element":format!("e:{i}")})).collect::<Vec<_>>()})
}
fn rules() -> Result<GridRuleSet> {
    Ok(serde_json::from_str(include_str!(
        "../../../harness/views/trace-matrix.viewrules.json"
    ))?)
}
#[test]
fn sparse_determinism_provenance_calls_flat_scope_and_outside_targets() -> Result {
    let f = Fake::new();
    let r = rules()?;
    let s = run(&f, &r, scope(&[0, 1, 2]), GridLimits::default())?;
    assert_eq!(s.grid.cells().len(), 1);
    assert_eq!(s.grid.cells()[0].members.len(), 2);
    assert_eq!(f.calls.borrow()["traceTargets"], 3);
    assert_eq!(f.calls.borrow()["outgoingTraces"], 3);
    assert_eq!(f.calls.borrow()["traceTarget"], 2);
    assert_eq!(
        serde_json::to_vec(&s)?,
        serde_json::to_vec(&run(&f, &r, scope(&[0, 1, 2]), GridLimits::default())?)?
    );
    let mut duplicate = Fake::new();
    duplicate.duplicate = true;
    assert_eq!(
        run(&duplicate, &r, scope(&[0, 1, 2]), GridLimits::default())?
            .grid
            .cells()[0]
            .members
            .len(),
        2
    );
    let mut outside = Fake::new();
    outside.off_axis = true;
    assert!(
        !run(&outside, &r, scope(&[0, 1, 2]), GridLimits::default())?
            .problems
            .is_empty()
    );
    let mut bad = Fake::new();
    bad.inconsistent = true;
    assert!(
        run(&bad, &r, scope(&[0, 1]), GridLimits::default())
            .err()
            .ok_or("No error")?
            .to_string()
            .contains("grid.provenance.inconsistent")
    );
    let flat = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":"e:0"},{"op":"addSeed","element":"e:1"},{"op":"hide","element":"e:0"},{"op":"addSeed","element":"e:0"},{"op":"removeSeed","element":"e:1"},{"op":"addSeed","element":"missing"}]});
    let s = run(&f, &r, flat, GridLimits::default())?;
    assert_eq!(s.grid.rows()[0].binding.key, "e:0");
    assert!(s.grid.cells().is_empty());
    assert_eq!(s.problems.len(), 4);
    for op in [
        json!({"op":"expand","element":"e:0","relation":"x","hops":1}),
        json!({"op":"collapse","element":"e:0","context":[]}),
    ] {
        assert!(
            run(
                &f,
                &r,
                json!({"schemaVersion":1,"ops":[op]}),
                GridLimits::default()
            )
            .err()
            .ok_or("No error")?
            .to_string()
            .contains("grid.scope.unsupported")
        );
    }
    Ok(())
}
#[test]
fn limits_fail_and_tables_preserve_zero_empty_string_and_absence() -> Result {
    let f = Fake::new();
    let r = rules()?;
    for (limits, name) in [
        (
            GridLimits {
                rows: 1,
                ..Default::default()
            },
            "rows",
        ),
        (
            GridLimits {
                columns: 1,
                ..Default::default()
            },
            "columns",
        ),
        (
            GridLimits {
                cells: 0,
                ..Default::default()
            },
            "cells",
        ),
        (
            GridLimits {
                members: 1,
                ..Default::default()
            },
            "members",
        ),
        (
            GridLimits {
                work: 1,
                ..Default::default()
            },
            "work",
        ),
    ] {
        let error = run(&f, &r, scope(&[0, 1, 2]), limits)
            .err()
            .ok_or("Limit accepted")?;
        assert!(error.to_string().to_lowercase().contains(name), "{error}");
    }
    let table: GridRuleSet = serde_json::from_str(include_str!(
        "../../../harness/views/box-table.viewrules.json"
    ))?;
    let s = run(&f, &table, scope(&[0, 1, 2]), GridLimits::default())?;
    assert_eq!(s.grid.cells().len(), 4);
    assert!(matches!(&s.grid.cells()[0].value,GridValue::String{value}if value.is_empty()));
    assert!(matches!(&s.grid.cells()[1].value,GridValue::Integer{value}if value=="0"));
    let empty = run(&f, &r, scope(&[]), GridLimits::default())?;
    assert!(empty.grid.rows().is_empty());
    Ok(())
}
