//! Strict graph/grid unions and renderer-neutral sparse grid contracts.
use super::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug)]
pub enum Scene {
    Graph(GraphScene),
    Grid(GridScene),
    LaneGraph(LaneGraphScene),
}
#[derive(Clone, Debug)]
pub enum RuleSet {
    Graph(GraphRuleSet),
    Grid(GridRuleSet),
    LaneGraph(Box<LaneGraphRuleSet>),
}
macro_rules! union_serde {
    ($ty:ident,$a:ident,$b:ident) => {
        impl Serialize for $ty {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                match self {
                    Self::Graph(x) => x.serialize(s),
                    Self::Grid(x) => x.serialize(s),
                    Self::LaneGraph(x) => x.serialize(s),
                }
            }
        }
        impl<'de> Deserialize<'de> for $ty {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let v = Value::deserialize(d)?;
                match v.get("form").and_then(Value::as_str) {
                    Some("graph") => serde_json::from_value::<$a>(v)
                        .map(Self::Graph)
                        .map_err(serde::de::Error::custom),
                    Some("grid") => serde_json::from_value::<$b>(v)
                        .map(Self::Grid)
                        .map_err(serde::de::Error::custom),
                    Some("laneGraph") => serde_json::from_value(v)
                        .map(Self::LaneGraph)
                        .map_err(serde::de::Error::custom),
                    _ => Err(serde::de::Error::custom("Unknown scene/rule form")),
                }
            }
        }
    };
}
union_serde!(Scene, GraphScene, GridScene);
union_serde!(RuleSet, GraphRuleSet, GridRuleSet);
impl From<GraphScene> for Scene {
    fn from(s: GraphScene) -> Self {
        Self::Graph(s)
    }
}
impl From<GridScene> for Scene {
    fn from(s: GridScene) -> Self {
        Self::Grid(s)
    }
}
impl Scene {
    pub fn graph(&self) -> Result<&GraphScene, String> {
        match self {
            Self::Graph(s) => Ok(s),
            _ => Err("Expected graph scene".into()),
        }
    }
    pub fn grid(&self) -> Result<&GridScene, String> {
        match self {
            Self::Grid(s) => Ok(s),
            _ => Err("Expected grid scene".into()),
        }
    }
    pub fn view(&self) -> &View {
        match self {
            Self::Graph(s) => &s.view,
            Self::Grid(s) => &s.view,
            Self::LaneGraph(s) => &s.view,
        }
    }
    pub fn palette(&self) -> &Palette {
        match self {
            Self::Graph(s) => &s.palette,
            Self::Grid(s) => &s.palette,
            Self::LaneGraph(s) => &s.palette,
        }
    }
    pub fn rule_set(&self) -> &str {
        match self {
            Self::Graph(s) => &s.rule_set,
            Self::Grid(s) => &s.rule_set,
            Self::LaneGraph(s) => &s.rule_set,
        }
    }
    pub fn revision(&self) -> u64 {
        match self {
            Self::Graph(s) => s.revision,
            Self::Grid(s) => s.revision,
            Self::LaneGraph(s) => s.revision,
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Graph(s) => s.validate(),
            Self::Grid(s) => s.validate(),
            Self::LaneGraph(s) => s.validate(),
        }
    }
}
impl RuleSet {
    pub fn id(&self) -> &str {
        match self {
            Self::Graph(r) => &r.id,
            Self::Grid(r) => &r.id,
            Self::LaneGraph(r) => &r.id,
        }
    }
    pub fn label(&self) -> &str {
        match self {
            Self::Graph(r) => &r.label,
            Self::Grid(r) => &r.label,
            Self::LaneGraph(r) => &r.label,
        }
    }
    pub fn language(&self) -> &str {
        match self {
            Self::Graph(r) => &r.language,
            Self::Grid(r) => &r.language,
            Self::LaneGraph(r) => &r.language,
        }
    }
    pub fn graph(&self) -> Result<&GraphRuleSet, String> {
        match self {
            Self::Graph(r) => Ok(r),
            _ => Err("Expected graph rule set".into()),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Graph(r) => r.validate(),
            Self::Grid(r) => r.validate(),
            Self::LaneGraph(r) => r.validate(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridScene {
    pub schema_version: u32,
    pub form: String,
    pub rule_set: String,
    pub revision: u64,
    pub view: View,
    pub palette: Palette,
    pub problems: Vec<String>,
    pub grid: Grid,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxisEntry {
    pub id: String,
    pub label: String,
    pub binding: Binding,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GridScalar {
    String,
    Integer,
    Boolean,
    Reference,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionColumn {
    pub id: String,
    pub label: String,
    pub scalar: GridScalar,
    pub many: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GridValue {
    String { value: String },
    Integer { value: String },
    Boolean { value: bool },
    Reference { label: String, binding: Binding },
    List { items: Vec<GridValue> },
}
impl GridValue {
    pub fn scalar(&self) -> Result<GridScalar, String> {
        Ok(match self {
            Self::String { .. } => GridScalar::String,
            Self::Integer { .. } => GridScalar::Integer,
            Self::Boolean { .. } => GridScalar::Boolean,
            Self::Reference { .. } => GridScalar::Reference,
            Self::List { .. } => return Err("Nested grid lists are unsupported".into()),
        })
    }
    fn validate(&self, items: &mut usize) -> Result<(), String> {
        match self {
            Self::String { value } => {
                if value.len() > 65536 {
                    return Err("Grid scalar string limit exceeded".into());
                }
            }
            Self::Integer { value } => {
                let n = value.parse::<i64>().map_err(|_| "Invalid grid int64")?;
                if n.to_string() != *value {
                    return Err("Noncanonical grid integer".into());
                }
            }
            Self::Reference { label, binding } => {
                label_limit(label)?;
                binding.validate()?;
            }
            Self::List { items: values } => {
                if values.is_empty() {
                    return Err("Empty grid lists must be absent".into());
                }
                *items += values.len();
                if *items > 5000 {
                    return Err("Grid list items limit exceeded".into());
                }
                let scalar = values[0].scalar()?;
                for v in values {
                    if v.scalar()? != scalar {
                        return Err("Heterogeneous grid list".into());
                    }
                    v.validate(items)?;
                }
            }
            Self::Boolean { .. } => {}
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridMember {
    pub id: String,
    pub label: String,
    pub binding: Binding,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridCell {
    pub id: String,
    pub row: String,
    pub column: String,
    pub origin: String,
    pub value: GridValue,
    pub binding: Binding,
    pub members: Vec<GridMember>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Grid {
    Table {
        rows: Vec<AxisEntry>,
        columns: Vec<ProjectionColumn>,
        cells: Vec<GridCell>,
    },
    Matrix {
        rows: Vec<AxisEntry>,
        columns: Vec<AxisEntry>,
        cells: Vec<GridCell>,
    },
}
impl Grid {
    pub fn rows(&self) -> &[AxisEntry] {
        match self {
            Self::Table { rows, .. } | Self::Matrix { rows, .. } => rows,
        }
    }
    pub fn cells(&self) -> &[GridCell] {
        match self {
            Self::Table { cells, .. } | Self::Matrix { cells, .. } => cells,
        }
    }
    pub fn matrix_columns(&self) -> Result<&[AxisEntry], String> {
        match self {
            Self::Matrix { columns, .. } => Ok(columns),
            _ => Err("Table has no model column axis".into()),
        }
    }
}
fn label_limit(s: &str) -> Result<(), String> {
    if s.len() > 4096 {
        Err("Grid label limit exceeded".into())
    } else {
        Ok(())
    }
}
impl GridScene {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != VERSION || self.form != "grid" {
            return Err("Unsupported grid scene version/form".into());
        }
        identity(&self.rule_set)?;
        revision(self.revision)?;
        self.view.validate()?;
        self.palette.validate()?;
        let mut ids = BTreeSet::new();
        let mut add = |id: &str| -> Result<(), String> {
            identity(id)?;
            if !ids.insert(id.to_owned()) {
                return Err("Duplicate grid symbol ID".into());
            }
            Ok(())
        };
        let rows = self.grid.rows();
        if rows.len() > 500 {
            return Err("Grid rows limit exceeded".into());
        }
        let mut row_keys = BTreeSet::new();
        for row in rows {
            add(&row.id)?;
            label_limit(&row.label)?;
            row.binding.validate()?;
            if !row.binding.context.is_empty() || !row_keys.insert(&row.binding.key) {
                return Err("Duplicate or contextual grid row".into());
            }
        }
        let mut column_ids = BTreeSet::new();
        let mut projections = BTreeMap::new();
        match &self.grid {
            Grid::Table { columns, .. } => {
                if columns.is_empty() || columns.len() > 30 {
                    return Err("Grid table columns limit exceeded".into());
                }
                for c in columns {
                    add(&c.id)?;
                    label_limit(&c.label)?;
                    column_ids.insert(c.id.as_str());
                    projections.insert(c.id.as_str(), c);
                }
            }
            Grid::Matrix { columns, .. } => {
                if columns.len() > 128 {
                    return Err("Grid matrix columns limit exceeded".into());
                }
                let mut keys = BTreeSet::new();
                for c in columns {
                    add(&c.id)?;
                    label_limit(&c.label)?;
                    c.binding.validate()?;
                    if !c.binding.context.is_empty() || !keys.insert(&c.binding.key) {
                        return Err("Duplicate or contextual matrix column".into());
                    }
                    column_ids.insert(c.id.as_str());
                }
            }
        }
        if self.grid.cells().len() > 5000 {
            return Err("Grid cells limit exceeded".into());
        }
        let row_ids: BTreeMap<_, _> = rows.iter().map(|r| (r.id.as_str(), r)).collect();
        let mut pairs = BTreeSet::new();
        let mut members = 0;
        let mut items = 0;
        for cell in self.grid.cells() {
            add(&cell.id)?;
            let row = row_ids.get(cell.row.as_str()).ok_or("Dangling grid row")?;
            if !column_ids.contains(cell.column.as_str())
                || !pairs.insert((&cell.row, &cell.column))
            {
                return Err("Dangling/duplicate grid cell".into());
            }
            cell.binding.validate()?;
            cell.value.validate(&mut items)?;
            match &self.grid {
                Grid::Table { .. } => {
                    let c = projections[cell.column.as_str()];
                    let values = match &cell.value {
                        GridValue::List { items } if c.many => items.as_slice(),
                        v if !c.many => std::slice::from_ref(v),
                        _ => return Err("Grid projection multiplicity mismatch".into()),
                    };
                    for value in values {
                        if value.scalar()? != c.scalar {
                            return Err("Grid projection scalar mismatch".into());
                        }
                    }
                    if cell.origin != "query"
                        || !cell.members.is_empty()
                        || serde_json::to_value(&cell.binding).map_err(|e| e.to_string())?
                            != serde_json::to_value(&row.binding).map_err(|e| e.to_string())?
                    {
                        return Err("Invalid query provenance".into());
                    }
                }
                Grid::Matrix { .. } => match (cell.origin.as_str(), &cell.value) {
                    ("derived", GridValue::Boolean { value: true })
                        if cell.members.is_empty()
                            && serde_json::to_value(&cell.binding)
                                .map_err(|e| e.to_string())?
                                == serde_json::to_value(&row.binding)
                                    .map_err(|e| e.to_string())? => {}
                    ("relation", GridValue::Integer { value })
                        if !cell.members.is_empty() && *value == cell.members.len().to_string() =>
                    {
                        if serde_json::to_value(&cell.binding).map_err(|e| e.to_string())?
                            != serde_json::to_value(&cell.members[0].binding)
                                .map_err(|e| e.to_string())?
                        {
                            return Err("Invalid relation binding".into());
                        }
                    }
                    _ => return Err("Invalid matrix provenance".into()),
                },
            }
            let mut keys = BTreeSet::new();
            for member in &cell.members {
                add(&member.id)?;
                member.binding.validate()?;
                label_limit(&member.label)?;
                if !keys.insert(&member.binding.key) {
                    return Err("Duplicate cell member".into());
                }
                members += 1;
                if members > 5000 {
                    return Err("Grid members limit exceeded".into());
                }
            }
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("Grid encoded scene limit exceeded".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridRuleSet {
    pub schema_version: u32,
    pub projection: crate::ProjectionPolicy,
    pub id: String,
    pub label: String,
    pub language: String,
    pub form: String,
    pub grid: GridDefinition,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnRule {
    pub id: String,
    pub label: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxisRule {
    pub query: Value,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemberRule {
    pub select: String,
    pub column: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridCreate {
    pub tool: String,
    pub command: String,
    pub row_accepts: String,
    pub column_accepts: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridDelete {
    pub tool: String,
    pub command: String,
    pub accepts: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridEdit {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub create: Option<GridCreate>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub delete: Option<GridDelete>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellRule {
    pub related: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub members: Option<MemberRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub edit: Option<GridEdit>,
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum GridDefinition {
    Table {
        query: Value,
        #[serde(rename = "rowLabel")]
        row_label: String,
        columns: Vec<ColumnRule>,
    },
    Matrix {
        rows: AxisRule,
        columns: AxisRule,
        cells: Box<CellRule>,
    },
}
impl GridRuleSet {
    pub fn validate(&self) -> Result<(), String> {
        self.projection.validate(false)?;
        if self.schema_version != RULE_VERSION || self.form != "grid" {
            return Err("Unsupported grid rule version/form".into());
        }
        for s in [&self.id, &self.label, &self.language] {
            identity(s)?;
        }
        match &self.grid {
            GridDefinition::Table {
                query,
                row_label,
                columns,
            } => {
                validate_query(query)?;
                identity(row_label)?;
                if columns.is_empty() || columns.len() > 30 {
                    return Err("Grid table columns limit exceeded".into());
                }
                let mut ids = BTreeSet::new();
                let mut names = BTreeSet::from([row_label.as_str()]);
                for c in columns {
                    identity(&c.id)?;
                    identity(&c.value)?;
                    if !ids.insert(&c.id) || !names.insert(&c.value) {
                        return Err("Duplicate table column/value".into());
                    }
                }
                let selects = query["select"].as_array().ok_or("Missing select")?;
                if selects.len() != names.len()
                    || selects
                        .iter()
                        .any(|c| !names.contains(c["name"].as_str().unwrap_or("")))
                {
                    return Err("Every grid projection must be used exactly once".into());
                }
            }
            GridDefinition::Matrix {
                rows,
                columns,
                cells,
            } => {
                for axis in [rows, columns] {
                    validate_query(&axis.query)?;
                    identity(&axis.label)?;
                    let selects = axis.query["select"].as_array().ok_or("Missing select")?;
                    if selects.len() != 1 || selects[0]["name"] != axis.label {
                        return Err("Matrix axis requires exactly one label projection".into());
                    }
                }
                identity(&cells.related)?;
                if let Some(m) = &cells.members {
                    for s in [&m.select, &m.column, &m.label] {
                        identity(s)?;
                    }
                }
                if let Some(e) = &cells.edit {
                    if cells.members.is_none() || e.create.is_none() && e.delete.is_none() {
                        return Err("Grid editing requires provenance and actions".into());
                    }
                    let mut tools = BTreeSet::from(["select"]);
                    if let Some(c) = &e.create {
                        for s in [&c.tool, &c.command, &c.row_accepts, &c.column_accepts] {
                            identity(s)?;
                        }
                        if !tools.insert(&c.tool) {
                            return Err("Duplicate grid tool".into());
                        }
                    }
                    if let Some(d) = &e.delete {
                        for s in [&d.tool, &d.command, &d.accepts] {
                            identity(s)?;
                        }
                        if !tools.insert(&d.tool) {
                            return Err("Duplicate grid tool".into());
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
/// Structural mirror only; the host additionally deserializes Model's native AST.
pub fn validate_query(value: &Value) -> Result<(), String> {
    fn fields<'a>(
        v: &'a Value,
        required: &[&str],
        optional: &[&str],
    ) -> Result<&'a serde_json::Map<String, Value>, String> {
        let o = v.as_object().ok_or("Expected query object")?;
        if required.iter().any(|k| !o.contains_key(*k))
            || o.keys()
                .any(|k| !required.contains(&k.as_str()) && !optional.contains(&k.as_str()))
        {
            return Err("Missing/unknown query field".into());
        }
        Ok(o)
    }
    fn expr(v: &Value, n: &mut usize) -> Result<(), String> {
        *n += 1;
        if *n > 512 {
            return Err("Query expression limit".into());
        }
        match v["op"].as_str() {
            Some("field" | "count") => {
                fields(v, &["op", "path"], &[])?;
                identity(v["path"].as_str().ok_or("Invalid path")?)?;
            }
            Some("literal") => {
                fields(v, &["op", "value"], &[])?;
            }
            _ => return Err("Unknown query expression/parameter".into()),
        }
        Ok(())
    }
    fn pred(v: &Value, n: &mut usize, depth: usize) -> Result<(), String> {
        *n += 1;
        if *n > 512 || depth > 24 {
            return Err("Query predicate limit".into());
        }
        match v["op"].as_str() {
            Some("is_null") => {
                fields(v, &["op", "expression"], &[])?;
                expr(&v["expression"], n)?;
            }
            Some("compare") => {
                fields(v, &["op", "left", "comparison", "right"], &[])?;
                if !["eq", "ne", "lt", "le", "gt", "ge"]
                    .contains(&v["comparison"].as_str().unwrap_or(""))
                {
                    return Err("Unknown comparison".into());
                }
                expr(&v["left"], n)?;
                expr(&v["right"], n)?;
            }
            Some("and" | "or") => {
                fields(v, &["op", "predicates"], &[])?;
                for p in v["predicates"].as_array().ok_or("Invalid predicates")? {
                    pred(p, n, depth + 1)?;
                }
            }
            Some("not") => {
                fields(v, &["op", "predicate"], &[])?;
                pred(&v["predicate"], n, depth + 1)?;
            }
            Some("any" | "all") => {
                fields(v, &["op", "path", "predicate"], &[])?;
                identity(v["path"].as_str().ok_or("Invalid path")?)?;
                pred(&v["predicate"], n, depth + 1)?;
            }
            _ => return Err("Unknown query predicate".into()),
        }
        Ok(())
    }
    fields(value, &["from", "select"], &["filter", "order_by"])?;
    identity(value["from"].as_str().ok_or("Missing query class")?)?;
    let select = value["select"].as_array().ok_or("Missing query select")?;
    if select.is_empty() || select.len() > 31 {
        return Err("Query projection limit".into());
    }
    let mut names = BTreeSet::new();
    let mut n = 0;
    for c in select {
        fields(c, &["name", "expression"], &[])?;
        let name = c["name"].as_str().ok_or("Invalid query column")?;
        identity(name)?;
        if name == "__element" || !names.insert(name) {
            return Err("Duplicate/reserved query projection".into());
        }
        expr(&c["expression"], &mut n)?;
    }
    if !value["filter"].is_null() {
        pred(&value["filter"], &mut n, 0)?;
    }
    if let Some(orders) = value.get("order_by") {
        let orders = orders.as_array().ok_or("Invalid order_by")?;
        if orders.len() > 8 {
            return Err("Query ordering limit".into());
        }
        for o in orders {
            fields(o, &["expression"], &["descending"])?;
            if o.get("descending").is_some_and(|v| !v.is_boolean()) {
                return Err("Invalid ordering direction".into());
            }
            expr(&o["expression"], &mut n)?;
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridTargetResponse {
    pub revision: u64,
    pub view_key: String,
    pub tool_id: String,
    pub row: String,
    pub column: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub member: Option<String>,
    pub enabled: bool,
    pub reason: String,
}
impl GridTargetResponse {
    pub fn validate(&self) -> Result<(), String> {
        revision(self.revision)?;
        for s in [&self.view_key, &self.tool_id, &self.row, &self.column] {
            identity(s)?;
        }
        if let Some(m) = &self.member {
            identity(m)?;
        }
        if !self.enabled && self.reason.is_empty() {
            return Err("Disabled grid target requires a reason".into());
        }
        Ok(())
    }
}

impl From<LaneGraphScene> for Scene {
    fn from(s: LaneGraphScene) -> Self {
        Self::LaneGraph(s)
    }
}
impl Scene {
    pub fn lane_graph(&self) -> Result<&LaneGraphScene, String> {
        match self {
            Self::LaneGraph(s) => Ok(s),
            _ => Err("Expected lane graph scene".into()),
        }
    }
}
