//! Sparse grid evaluation through opaque query/function adapters. No Model dependency.
use crate::{ElementId, EngineError, ViewFunctions, ViewModel};
use intersect_views::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub struct QueryRow {
    pub element: ElementId,
    pub values: BTreeMap<String, Option<GridValue>>,
}
pub struct QueryColumn {
    pub name: String,
    pub scalar: GridScalar,
    pub many: bool,
}
pub struct QueryTable {
    pub rows: Vec<QueryRow>,
    pub columns: Vec<QueryColumn>,
}
pub trait GridQueries {
    fn query(
        &self,
        role: &str,
        candidates: &[ElementId],
        limit: usize,
    ) -> Result<QueryTable, EngineError>;
}
#[derive(Clone, Copy)]
pub struct GridLimits {
    pub rows: usize,
    pub columns: usize,
    pub cells: usize,
    pub members: usize,
    pub work: usize,
}
impl Default for GridLimits {
    fn default() -> Self {
        Self {
            rows: 500,
            columns: 128,
            cells: 5000,
            members: 5000,
            work: 2_000_000,
        }
    }
}
pub fn symbol(parts: &[&str]) -> Result<String, EngineError> {
    Ok(format!(
        "symbol:{:x}",
        Sha256::digest(serde_json::to_vec(parts).map_err(|e| EngineError(e.to_string()))?)
    ))
}
struct Evaluation<'a> {
    rules: &'a GridRuleSet,
    view_key: &'a str,
    model: &'a dyn ViewModel,
    functions: &'a dyn ViewFunctions,
    limits: GridLimits,
    work: usize,
    members: usize,
    problems: Vec<String>,
}
impl Evaluation<'_> {
    fn id(&self, role: &str, a: &str, b: Option<&str>) -> Result<String, EngineError> {
        let mut parts = vec!["grid", self.view_key, &self.rules.id, role, a];
        if let Some(b) = b {
            parts.push(b);
        }
        symbol(&parts)
    }
    fn axis(
        &self,
        rows: &[QueryRow],
        label: &str,
        role: &str,
    ) -> Result<Vec<AxisEntry>, EngineError> {
        let mut seen = BTreeSet::new();
        rows.iter()
            .map(|r| {
                let key = self.model.key(r.element)?;
                if !seen.insert(key.clone()) {
                    return Err(EngineError("Duplicate query subject".into()));
                }
                let Some(Some(GridValue::String { value })) = r.values.get(label) else {
                    return Err(EngineError("Axis label must be a present String".into()));
                };
                Ok(AxisEntry {
                    id: self.id(role, &key, None)?,
                    label: value.clone(),
                    binding: self.model.binding(r.element, &[])?,
                })
            })
            .collect()
    }
    fn call(&mut self, name: &str, e: ElementId) -> Result<Vec<ElementId>, EngineError> {
        self.work += 1;
        if self.work > self.limits.work {
            return Err(EngineError::limit("Grid semantic work"));
        }
        self.functions.elements(name, e)
    }
    fn label(&mut self, name: &str, e: ElementId) -> Result<String, EngineError> {
        self.work += 1;
        if self.work > self.limits.work {
            return Err(EngineError::limit("Grid semantic work"));
        }
        self.functions.string(name, e)
    }
}
#[allow(clippy::too_many_arguments)]
pub fn evaluate(
    rules: &GridRuleSet,
    scope: &Scope,
    view: View,
    palette: Palette,
    revision: u64,
    model: &dyn ViewModel,
    functions: &dyn ViewFunctions,
    queries: &dyn GridQueries,
    limits: GridLimits,
) -> Result<GridScene, EngineError> {
    rules.validate()?;
    scope.validate()?;
    let mut candidates = vec![];
    let mut problems = vec![];
    for op in &scope.ops {
        let (key, add) = match op {
            ScopeOp::AddSeed { element } => (element, true),
            ScopeOp::Hide { element } | ScopeOp::RemoveSeed { element } => (element, false),
            _ => {
                return Err(EngineError(
                    "grid.scope.unsupported: expand/collapse are graph operations".into(),
                ));
            }
        };
        if let Some(id) = model.element(key) {
            if add {
                if !candidates.contains(&id) {
                    candidates.push(id);
                }
            } else {
                candidates.retain(|e| *e != id);
            }
        } else {
            problems.push(format!("Missing scoped element: {key}"));
        }
    }
    if candidates.len() > 4096 {
        return Err(EngineError::limit("Grid candidate roots"));
    }
    let view_key = view.key.clone();
    let mut e = Evaluation {
        rules,
        view_key: &view_key,
        model,
        functions,
        limits,
        work: 0,
        members: 0,
        problems,
    };
    let grid = match &rules.grid {
        GridDefinition::Table {
            row_label, columns, ..
        } => {
            let result = queries.query("table", &candidates, limits.rows)?;
            if result.rows.len() > limits.rows {
                return Err(EngineError::limit("Grid rows"));
            }
            let rows = e.axis(&result.rows, row_label, "row")?;
            let projected = columns
                .iter()
                .map(|c| {
                    let native = result
                        .columns
                        .iter()
                        .find(|n| n.name == c.value)
                        .ok_or_else(|| EngineError("Missing query projection".into()))?;
                    Ok(ProjectionColumn {
                        id: e.id("projection", &c.id, None)?,
                        label: c.label.clone(),
                        scalar: native.scalar.clone(),
                        many: native.many,
                    })
                })
                .collect::<Result<Vec<_>, EngineError>>()?;
            let mut cells = vec![];
            for (i, row) in result.rows.iter().enumerate() {
                for (c, column) in columns.iter().zip(&projected) {
                    if let Some(Some(value)) = row.values.get(&c.value) {
                        if cells.len() >= limits.cells {
                            return Err(EngineError::limit("Grid cells"));
                        }
                        cells.push(GridCell {
                            id: e.id("cell", &rows[i].id, Some(&column.id))?,
                            row: rows[i].id.clone(),
                            column: column.id.clone(),
                            origin: "query".into(),
                            value: value.clone(),
                            binding: rows[i].binding.clone(),
                            members: vec![],
                        });
                    }
                }
            }
            Grid::Table {
                rows,
                columns: projected,
                cells,
            }
        }
        GridDefinition::Matrix {
            rows: row_rule,
            columns: column_rule,
            cells: cell_rule,
        } => {
            let row_result = queries.query("rows", &candidates, limits.rows)?;
            let column_result = queries.query("columns", &candidates, limits.columns)?;
            if row_result.rows.len() > limits.rows {
                return Err(EngineError::limit("Grid rows"));
            }
            if column_result.rows.len() > limits.columns {
                return Err(EngineError::limit("Grid matrix columns"));
            }
            let rows = e.axis(&row_result.rows, &row_rule.label, "row")?;
            let columns = e.axis(&column_result.rows, &column_rule.label, "column")?;
            let column_indices: BTreeMap<_, _> = column_result
                .rows
                .iter()
                .enumerate()
                .map(|(i, r)| (r.element, i))
                .collect();
            let mut cells = vec![];
            let column_class = column_rule.query["from"]
                .as_str()
                .ok_or("Missing column class".to_owned())?;
            for (i, row) in row_result.rows.iter().enumerate() {
                let mut targets = BTreeSet::new();
                let mut seen_targets = BTreeSet::new();
                for target in e.call(&cell_rule.related, row.element)? {
                    if !seen_targets.insert(target) {
                        continue;
                    }
                    if !model.is_a(target, column_class)? {
                        return Err(EngineError(
                            "Related function returned incompatible class".into(),
                        ));
                    }
                    if let Some(index) = column_indices.get(&target) {
                        targets.insert(*index);
                    } else {
                        e.problems.push(format!(
                            "Outside matrix column axis: {}",
                            model.key(target)?
                        ));
                    }
                }
                let mut members: BTreeMap<usize, Vec<GridMember>> = BTreeMap::new();
                if let Some(member_rule) = &cell_rule.members {
                    let mut seen = BTreeSet::new();
                    for member in e.call(&member_rule.select, row.element)? {
                        if !seen.insert(member) {
                            continue;
                        }
                        e.members += 1;
                        if e.members > limits.members {
                            return Err(EngineError::limit("Grid members"));
                        }
                        let target = e.call(&member_rule.column, member)?;
                        if target.len() != 1 {
                            return Err(EngineError(
                                "Member column function must return exactly one element".into(),
                            ));
                        }
                        if !model.is_a(target[0], column_class)? {
                            return Err(EngineError("Member column has incompatible class".into()));
                        }
                        let label = e.label(&member_rule.label, member)?;
                        if let Some(index) = column_indices.get(&target[0]) {
                            let cell_id = e.id("cell", &rows[i].id, Some(&columns[*index].id))?;
                            let key = model.key(member)?;
                            members.entry(*index).or_default().push(GridMember {
                                id: e.id("member", &cell_id, Some(&key))?,
                                label,
                                binding: model.binding(member, &[])?,
                            });
                        } else {
                            e.problems.push(format!(
                                "Outside matrix member column axis: {}",
                                model.key(target[0])?
                            ));
                        }
                    }
                    if members.keys().copied().collect::<BTreeSet<_>>() != targets {
                        return Err(EngineError("grid.provenance.inconsistent".into()));
                    }
                }
                for j in targets {
                    if cells.len() >= limits.cells {
                        return Err(EngineError::limit("Grid cells"));
                    }
                    let selected = members.remove(&j).unwrap_or_default();
                    let (origin, value, binding) = if cell_rule.members.is_some() {
                        (
                            "relation",
                            GridValue::Integer {
                                value: selected.len().to_string(),
                            },
                            selected
                                .first()
                                .ok_or_else(|| EngineError("Missing relation provenance".into()))?
                                .binding
                                .clone(),
                        )
                    } else {
                        (
                            "derived",
                            GridValue::Boolean { value: true },
                            rows[i].binding.clone(),
                        )
                    };
                    cells.push(GridCell {
                        id: e.id("cell", &rows[i].id, Some(&columns[j].id))?,
                        row: rows[i].id.clone(),
                        column: columns[j].id.clone(),
                        origin: origin.into(),
                        value,
                        binding,
                        members: selected,
                    });
                }
            }
            Grid::Matrix {
                rows,
                columns,
                cells,
            }
        }
    };
    let scene = GridScene {
        schema_version: VERSION,
        form: "grid".into(),
        rule_set: rules.id.clone(),
        revision,
        view,
        palette,
        problems: e.problems,
        grid,
    };
    scene.validate()?;
    Ok(scene)
}
