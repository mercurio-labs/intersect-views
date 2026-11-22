//! Frozen-store adapters for QueryPlan-backed grids and focused edit targets.
use crate::{
    Host, Snapshot, identity,
    scenes::{FunctionAdapter, ModelAdapter},
};
use intersect_model::core::query::{QueryBudget, ScalarType, ValueType};
use intersect_view_engine::{
    ElementId, EngineError, ViewFunctions, ViewModel,
    grid::{GridLimits, GridQueries, QueryColumn, QueryRow, QueryTable},
};
use intersect_views::*;
use serde_json::{Value, json};
use std::{cell::RefCell, collections::BTreeMap};
struct Queries<'a> {
    host: &'a Host,
    snapshot: &'a Snapshot,
    model: &'a ModelAdapter<'a>,
    rules: &'a GridRuleSet,
    budget: &'a RefCell<QueryBudget>,
}
fn scalar(ty: &ScalarType) -> Result<GridScalar, String> {
    match ty {
        ScalarType::String => Ok(GridScalar::String),
        ScalarType::Integer => Ok(GridScalar::Integer),
        ScalarType::Boolean => Ok(GridScalar::Boolean),
        ScalarType::Reference(_) => Ok(GridScalar::Reference),
        _ => Err("Unsupported grid projection type".into()),
    }
}
impl Queries<'_> {
    fn atom(&self, v: &Value, ty: &ScalarType) -> Result<GridValue, String> {
        Ok(match ty {
            ScalarType::String => GridValue::String {
                value: v.as_str().ok_or("Invalid query String")?.into(),
            },
            ScalarType::Boolean => GridValue::Boolean {
                value: v.as_bool().ok_or("Invalid query Bool")?,
            },
            ScalarType::Integer => {
                let value = if let Some(n) = v.as_i64() {
                    n.to_string()
                } else {
                    intersect_model::definitions::scalars::Builtin::ELong
                        .format(v)?
                        .ok_or("Missing integer")?
                };
                GridValue::Integer { value }
            }
            ScalarType::Reference(_) => {
                let o = self
                    .snapshot
                    .model()
                    .lookup(v.as_str().ok_or("Invalid query reference")?)
                    .ok_or("Missing query target")?;
                let binding = self
                    .model
                    .binding(ElementId::new(o.id().index()), &[])
                    .map_err(|e| e.to_string())?;
                let label = identity::name(o, &self.host.language.definition.name_features)
                    .map_or_else(|| binding.key.clone(), str::to_owned);
                GridValue::Reference { label, binding }
            }
            _ => return Err("Unsupported grid scalar".into()),
        })
    }
    fn value(&self, v: &Value, ty: &ValueType) -> Result<Option<GridValue>, String> {
        if v.is_null() {
            return Ok(None);
        }
        if ty.many {
            let values = v.as_array().ok_or("Invalid collection query value")?;
            if values.is_empty() {
                return Ok(None);
            }
            Ok(Some(GridValue::List {
                items: values
                    .iter()
                    .map(|v| self.atom(v, &ty.scalar))
                    .collect::<Result<_, _>>()?,
            }))
        } else {
            Ok(Some(self.atom(v, &ty.scalar)?))
        }
    }
}
impl GridQueries for Queries<'_> {
    fn query(
        &self,
        role: &str,
        candidates: &[ElementId],
        limit: usize,
    ) -> Result<QueryTable, EngineError> {
        let q = self
            .host
            .language
            .cache()
            .queries
            .get(&(self.rules.id.clone(), role.into()))
            .ok_or_else(|| EngineError("Missing prepared grid query".into()))?;
        let ids = candidates
            .iter()
            .map(|id| Ok(self.model.object(*id)?.identity().to_owned()))
            .collect::<Result<Vec<_>, EngineError>>()?;
        let mut budget = self
            .budget
            .try_borrow_mut()
            .map_err(|e| EngineError(e.to_string()))?;
        let output = q.execute(
            self.host.language.prepared().schema(),
            self.snapshot.accepted.reader(),
            &ids,
            limit,
            &mut budget,
        )?;
        let columns = q.plan.select[..q.types.len()]
            .iter()
            .zip(&q.types)
            .map(|(c, ty)| {
                Ok(QueryColumn {
                    name: c.name.clone(),
                    scalar: scalar(&ty.scalar)?,
                    many: ty.many,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let rows = output
            .rows
            .iter()
            .map(|values| {
                let id = values
                    .last()
                    .and_then(Value::as_str)
                    .ok_or("Missing hidden query ID")?;
                let o = self
                    .snapshot
                    .model()
                    .lookup(id)
                    .ok_or("Query ID outside model")?;
                let projected = q
                    .plan
                    .select
                    .iter()
                    .zip(&q.types)
                    .zip(values)
                    .map(|((c, ty), v)| Ok((c.name.clone(), self.value(v, ty)?)))
                    .collect::<Result<BTreeMap<_, _>, String>>()?;
                Ok(QueryRow {
                    element: ElementId::new(o.id().index()),
                    values: projected,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(QueryTable { rows, columns })
    }
}
pub(crate) fn grid_palette(rules: &GridRuleSet) -> Result<Palette, String> {
    let mut tools = vec![
        json!({"id":"select","label":"Select","icon":"pointer","gesture":"select","command":"presentation.select","parameters":{},"inputs":[]}),
    ];
    if let GridDefinition::Matrix { cells, .. } = &rules.grid
        && let Some(e) = &cells.edit
    {
        if let Some(c) = &e.create {
            tools.push(json!({"id":c.tool,"label":"Create relation","icon":"connection","gesture":"action","command":c.command,"parameters":{},"inputs":[{"id":"name","label":"Name","default":"newRelation"}]}));
        }
        if let Some(d) = &e.delete {
            tools.push(json!({"id":d.tool,"label":"Delete relation","icon":"connection","gesture":"action","command":d.command,"parameters":{},"inputs":[]}));
        }
    }
    let p:Palette=serde_json::from_value(json!({"schemaVersion":1,"id":format!("{}.default",rules.id),"label":rules.label,"groups":[{"id":"grid-tools","label":"Grid","entries":tools}]})).map_err(|e|e.to_string())?;
    p.validate()?;
    Ok(p)
}
pub(crate) fn grid_command<'a>(rules: &'a GridRuleSet, tool: &Tool) -> Option<&'a str> {
    if let GridDefinition::Matrix { cells, .. } = &rules.grid
        && let Some(e) = &cells.edit
    {
        if let Some(c) = &e.create
            && c.tool == tool.id
            && c.command == tool.command
        {
            return Some(&c.command);
        }
        if let Some(d) = &e.delete
            && d.tool == tool.id
            && d.command == tool.command
        {
            return Some(&d.command);
        }
    }
    None
}
impl Host {
    pub(super) fn checked_grid_target<'a>(
        &self,
        rules: &GridRuleSet,
        scene: &'a GridScene,
        tool: &Tool,
        row: &str,
        column: &str,
        member: Option<&str>,
    ) -> Result<(crate::GridCommandTarget<'a>, Option<String>), String> {
        let row = scene
            .grid
            .rows()
            .iter()
            .find(|r| r.id == row)
            .ok_or("Unknown grid row")?;
        let column = scene
            .grid
            .matrix_columns()?
            .iter()
            .find(|c| c.id == column)
            .ok_or("Unknown grid column")?;
        let cell = scene
            .grid
            .cells()
            .iter()
            .find(|c| c.row == row.id && c.column == column.id);
        let selected = member
            .map(|id| {
                cell.and_then(|c| c.members.iter().find(|m| m.id == id))
                    .ok_or("Unknown cell member")
            })
            .transpose()?;
        let snapshot = self.snapshot()?;
        let budget = RefCell::new(QueryBudget::new(
            self.language.definition.view_function_work,
        ));
        let f = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        let check = |name: &str, binding: &Binding| -> Result<bool, String> {
            let o = snapshot
                .model()
                .lookup(&binding.element_id)
                .ok_or("Target disappeared")?;
            f.boolean(name, ElementId::new(o.id().index()))
                .map_err(|e| e.to_string())
        };
        let mut reason = Some("No supported grid rule command".to_owned());
        if let GridDefinition::Matrix { cells, .. } = &rules.grid
            && let Some(edit) = &cells.edit
        {
            if let Some(c) = &edit.create
                && c.tool == tool.id
                && c.command == tool.command
            {
                reason = if !self.commands.supports(&c.command) {
                    Some("Unsupported grid command".into())
                } else if member.is_some() {
                    Some("Create does not accept a member".into())
                } else if cell.is_some() {
                    Some("Grid cell is already occupied".into())
                } else if row.binding.read_only || column.binding.read_only {
                    Some("Grid axis is read-only".into())
                } else if !check(&c.row_accepts, &row.binding)?
                    || !check(&c.column_accepts, &column.binding)?
                {
                    Some("Grid applicability predicate refused".into())
                } else {
                    None
                };
            }
            if let Some(d) = &edit.delete
                && d.tool == tool.id
                && d.command == tool.command
            {
                reason = if !self.commands.supports(&d.command) {
                    Some("Unsupported grid command".into())
                } else if let Some(m) = selected {
                    if m.binding.read_only {
                        Some("Relation member is read-only".into())
                    } else if !check(&d.accepts, &m.binding)? {
                        Some("Delete predicate refused".into())
                    } else {
                        None
                    }
                } else {
                    Some("Choose a relation member to delete".into())
                };
            }
        }
        Ok((
            crate::GridCommandTarget {
                row,
                column,
                member: selected,
            },
            reason,
        ))
    }
    pub(super) fn grid_targets(&self, params: &Value) -> Result<Value, String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            revision: u64,
            view_key: String,
            tool_id: String,
            row: String,
            column: String,
            #[serde(default)]
            member: Option<String>,
            #[serde(default)]
            scope: Option<Scope>,
            #[serde(default)]
            palette: Option<Palette>,
        }
        let p: Request = serde_json::from_value(params.clone())
            .map_err(|e| format!("Invalid grid target request: {e}"))?;
        let response = self.scene_response(&p.view_key, p.scope.as_ref(), p.palette)?;
        let scene = response.scene.grid()?;
        let RuleSet::Grid(rules) = self.rules_for(&scene.rule_set)? else {
            return Err("Expected grid rules".into());
        };
        let tool = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == p.tool_id)
            .ok_or("Unknown grid tool")?;
        let (_, reason) =
            self.checked_grid_target(rules, scene, tool, &p.row, &p.column, p.member.as_deref())?;
        Ok(
            json!({"revision":p.revision,"viewKey":p.view_key,"toolId":p.tool_id,"row":p.row,"column":p.column,"member":p.member,"enabled":reason.is_none(),"reason":reason.unwrap_or_default()}),
        )
    }
    pub(super) fn grid_response(
        &self,
        view: &intersect_views::View,
        doc: &ViewDocument,
        rules: &GridRuleSet,
        scope: Option<&Scope>,
        palette: Option<Palette>,
    ) -> Result<SceneResponse, String> {
        let snapshot = self.snapshot()?;
        let model = ModelAdapter::new(self, snapshot)?;
        let limits = GridLimits {
            work: self.language.definition.view_function_work,
            ..Default::default()
        };
        let budget = RefCell::new(QueryBudget::new(limits.work));
        let functions = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        let queries = Queries {
            host: self,
            snapshot,
            model: &model,
            rules,
            budget: &budget,
        };
        // A language-wide graph palette may coexist with grid rules. Default grid
        // actions are used unless the caller explicitly supplies a palette override.
        let palette = match palette {
            Some(p) => p,
            None => grid_palette(rules)?,
        };
        palette.validate()?;
        let scene = intersect_view_engine::grid::evaluate(
            rules,
            scope.unwrap_or(&doc.scope),
            view.clone(),
            palette,
            self.revision,
            &model,
            &functions,
            &queries,
            limits,
        )
        .map_err(|e| e.to_string())?;
        let capabilities = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .map(|t| {
                let enabled = t.gesture == "select"
                    || grid_command(rules, t).is_some_and(|id| self.commands.supports(id));
                ToolCapability {
                    tool_id: t.id.clone(),
                    enabled,
                    reason: if enabled {
                        String::new()
                    } else {
                        "No supported grid rule command".into()
                    },
                }
            })
            .collect();
        let response = SceneResponse {
            scene: scene.into(),
            capabilities,
            presentation: self.presentation_context(),
        };
        response.validate()?;
        Ok(response)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    type TestResult = std::result::Result<(), Box<dyn std::error::Error>>;
    #[test]
    fn focused_read_only_and_unsupported_checks_run_before_provider() -> TestResult {
        // Unit-test crate identity differs from the harness's dev-dependency host.
        // Copy only the registration data; a stub confirms applicability never calls prepare.
        let d = intersect_view_harness::definition();
        let language = crate::LanguageDefinition {
            id: d.id,
            name: d.name,
            namespace: d.namespace,
            file_extensions: d.file_extensions,
            structure: d.structure,
            grammar: d.grammar,
            bindings: d.bindings,
            view_functions: d.view_functions,
            extra_functions: d.extra_functions,
            view_execution_limits: d.view_execution_limits,
            view_function_work: d.view_function_work,
            rule_sets: d.rule_sets,
            notation: d.notation,
            palette: d.palette,
            name_features: d.name_features,
        };
        struct Supported;
        impl crate::Commands for Supported {
            fn supports(&self, _: &str) -> bool {
                true
            }
            fn prepare(
                &self,
                _: &crate::CommandContext<'_>,
                _: &PrepareCommand,
            ) -> Result<Vec<SourcePatch>, crate::CommandError> {
                Err(crate::CommandError::new(
                    "test",
                    "Applicability must not prepare",
                ))
            }
        }
        let mut h = Host::new(language, Box::new(Supported))?;
        h.dispatch(json!({"method":"workspace/analyze","params":{"revision":1,"sources":[{"uri":"grid.harness","text":include_str!("../../../harness/models/grid.harness")},{"uri":"matrix.view.json","text":json!({"schemaVersion":1,"key":"matrix","name":"Matrix","ruleSet":"harness.trace-matrix","scope":{"schemaVersion":1,"ops":[]}}).to_string()}]}}))?;
        let catalog = h.dispatch(json!({"method":"views/catalog","params":{"revision":1}}))?;
        let ops = catalog["views"][0]["owners"]
            .as_array()
            .ok_or("No owners")?
            .iter()
            .filter(|o| o["label"] == "Alpha" || o["label"] == "Beta")
            .map(|o| json!({"op":"addSeed","element":o["key"]}))
            .collect::<Vec<_>>();
        let response:SceneResponse=serde_json::from_value(h.dispatch(json!({"method":"views/scene","params":{"revision":1,"viewKey":"matrix","scope":{"schemaVersion":1,"ops":ops}}}))?)?;
        let mut scene = response.scene.grid()?.clone();
        let RuleSet::Grid(rules) = h.rules_for("harness.trace-matrix")? else {
            return Err("Not grid".into());
        };
        let tools = scene.palette.groups[0].entries.clone();
        let add = tools.iter().find(|t| t.id == "trace-add").ok_or("No add")?;
        let delete = tools
            .iter()
            .find(|t| t.id == "trace-remove")
            .ok_or("No delete")?;
        let Grid::Matrix { rows, columns, .. } = &mut scene.grid else {
            return Err("Not matrix".into());
        };
        let row = rows[0].id.clone();
        let empty = columns[0].id.clone();
        let occupied = columns[1].id.clone();
        rows[0].binding.read_only = true;
        assert!(
            h.checked_grid_target(rules, &scene, add, &row, &empty, None)?
                .1
                .is_some()
        );
        let member = scene.grid.cells()[0].members[0].id.clone();
        assert!(
            h.checked_grid_target(rules, &scene, delete, &row, &occupied, Some(&member))?
                .1
                .is_none()
        );
        let Grid::Matrix { cells, .. } = &mut scene.grid else {
            return Err("Not matrix".into());
        };
        cells[0].members[0].binding.read_only = true;
        assert!(
            h.checked_grid_target(rules, &scene, delete, &row, &occupied, Some(&member))?
                .1
                .is_some()
        );
        h.commands = Box::new(crate::NoCommands);
        let RuleSet::Grid(rules) = h.rules_for("harness.trace-matrix")? else {
            return Err("Not grid".into());
        };
        assert!(
            h.checked_grid_target(rules, &scene, add, &row, &empty, None)?
                .1
                .is_some_and(|s| s.contains("Unsupported"))
        );
        Ok(())
    }
}
