//! Native QueryPlan bridge. Candidate enumeration is scoped; reads are not.
use intersect_model::{
    core::{
        model::Element,
        query::{
            Column, Expression, NoDerivedValues, Ordering, Parameters, Predicate, QueryBudget,
            QueryLimits, QueryOutput, QueryPlan, ScalarType, ValueType, path_type,
        },
        storage::{ModelRead, Query, Row},
    },
    definitions::schema::Schema,
};
use serde::Deserialize;
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeSet};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Template {
    from: String,
    select: Vec<Column>,
    #[serde(default)]
    filter: Option<Predicate>,
    #[serde(default)]
    order_by: Vec<Ordering>,
}
pub struct GridQuery {
    pub plan: QueryPlan,
    pub types: Vec<ValueType>,
}
impl GridQuery {
    pub fn prepare(schema: &Schema, value: &Value) -> Result<Self, String> {
        fn no_parameters(v: &Value) -> Result<(), String> {
            match v {
                Value::Object(o) => {
                    if o.get("op").and_then(Value::as_str) == Some("parameter") {
                        return Err("Grid queries do not admit parameters".into());
                    }
                    for x in o.values() {
                        no_parameters(x)?;
                    }
                }
                Value::Array(a) => {
                    for x in a {
                        no_parameters(x)?;
                    }
                }
                _ => {}
            }
            Ok(())
        }
        // Bound the input before native validation or recursive decoding.
        if serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > 65536 {
            return Err("Grid query input limit exceeded".into());
        }
        no_parameters(value)?;
        let t: Template = serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid grid query: {e}"))?;
        if t.select.is_empty()
            || t.select.len() > 31
            || t.select.iter().any(|c| c.name == "__element")
        {
            return Err("Grid query reserves __element and admits 1–31 projections".into());
        }
        let mut plan = QueryPlan {
            schema_uri: schema.uri.clone(),
            schema_revision: schema.revision.clone(),
            from: t.from,
            filter: t.filter,
            select: t.select,
            order_by: t.order_by,
            limit: 500,
        };
        plan.select.push(Column {
            name: "__element".into(),
            expression: Expression::Field { path: "$id".into() },
        });
        plan.validate(schema, &Parameters::new(), &NoDerivedValues)?;
        let types = plan.select[..plan.select.len() - 1]
            .iter()
            .map(|c| match &c.expression {
                Expression::Field { path } => path_type(schema, &plan.from, path),
                Expression::Count { path } => Ok(ValueType {
                    scalar: ScalarType::Integer,
                    optional: path_type(schema, &plan.from, path)?.optional,
                    many: false,
                }),
                Expression::Literal { value } => Ok(ValueType {
                    scalar: if value.is_boolean() {
                        ScalarType::Boolean
                    } else if value.is_string() {
                        ScalarType::String
                    } else {
                        ScalarType::Integer
                    },
                    optional: false,
                    many: false,
                }),
                Expression::Parameter { .. } => Err("Grid query parameters are unsupported".into()),
            })
            .collect::<Result<Vec<_>, String>>()?;
        if types.iter().any(|ty| {
            !matches!(
                ty.scalar,
                ScalarType::String
                    | ScalarType::Integer
                    | ScalarType::Boolean
                    | ScalarType::Reference(_)
            )
        }) {
            return Err("Unsupported grid projection type".into());
        }
        Ok(Self { plan, types })
    }
    pub fn execute(
        &self,
        schema: &Schema,
        store: &dyn ModelRead,
        candidates: &[String],
        limit: usize,
        budget: &mut QueryBudget,
    ) -> Result<QueryOutput, String> {
        if candidates.len() > 4096 {
            return Err("Grid candidate roots limit exceeded".into());
        }
        let quota = (budget.remaining() / 2).min(100_000);
        if quota == 0 {
            return Err("Grid semantic work limit exceeded".into());
        }
        let scoped = Candidates {
            store,
            ids: candidates,
            budget: RefCell::new(QueryBudget::new(quota)),
        };
        if candidates.iter().collect::<BTreeSet<_>>().len() != candidates.len() {
            return Err("Duplicate grid candidates".into());
        }
        let mut plan = self.plan.clone();
        plan.limit = limit;
        let params = Parameters::new();
        let prepared = plan.prepare(schema, &params, &NoDerivedValues)?;
        let result = prepared.execute(
            &scoped,
            QueryLimits {
                max_steps: quota,
                max_results: limit,
            },
        )?;
        budget.charge_many(result.stats.reads + scoped.budget.borrow().reads)?;
        if result.has_more {
            return Err("Grid query result limit exceeded (has_more)".into());
        }
        if result.schema_revision != schema.revision {
            return Err("Grid query returned a stale schema revision".into());
        }
        Ok(result)
    }
}
struct Candidates<'a> {
    store: &'a dyn ModelRead,
    ids: &'a [String],
    budget: RefCell<QueryBudget>,
}
impl Candidates<'_> {
    fn charge(&self) -> Result<(), String> {
        self.budget
            .try_borrow_mut()
            .map_err(|e| e.to_string())?
            .charge()
            .map_err(|_| "Grid candidate adapter work limit exceeded".into())
    }
}
impl ModelRead for Candidates<'_> {
    fn revision(&self) -> Result<String, String> {
        self.charge()?;
        self.store.revision()
    }
    fn get(&self, id: &str) -> Result<Option<Element>, String> {
        self.charge()?;
        self.store.get(id)
    }
    fn class(&self, id: &str) -> Result<Option<String>, String> {
        self.charge()?;
        self.store.class(id)
    }
    fn value(&self, id: &str, field: &str) -> Result<Option<Value>, String> {
        self.charge()?;
        self.store.value(id, field)
    }
    fn page(&self, after: Option<u64>, limit: usize) -> Result<Vec<Row>, String> {
        self.id_page(after, limit)?
            .into_iter()
            .map(|(cursor, id)| Ok((cursor, self.get(&id)?.ok_or("Missing grid candidate")?)))
            .collect()
    }
    fn id_page(&self, after: Option<u64>, limit: usize) -> Result<Vec<(u64, String)>, String> {
        self.charge()?;
        if limit == 0 {
            return Err("Zero grid page size".into());
        }
        self.ids
            .iter()
            .enumerate()
            .filter(|(i, _)| after.is_none_or(|a| (*i as u64) > a))
            .take(limit)
            .map(|(i, id)| {
                self.charge()?;
                Ok((i as u64, id.clone()))
            })
            .collect()
    }
    fn query(&self, q: Query<'_>) -> Result<Vec<String>, String> {
        let mut result = vec![];
        for id in self.ids {
            if self.matches(id, q)? {
                result.push(id.clone());
            }
        }
        Ok(result)
    }
    fn matches(&self, id: &str, q: Query<'_>) -> Result<bool, String> {
        self.charge()?;
        self.store.matches(id, q)
    }
}
