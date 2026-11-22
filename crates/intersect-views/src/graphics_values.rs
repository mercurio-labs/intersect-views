//! Dimension-independent checks on evaluated parameters. Font measurement stays in the client.
use crate::*;
use std::collections::BTreeMap;
type Values = BTreeMap<String, GraphicValue>;
fn number(expr: &NumericExpression, values: &Values) -> Result<Option<f64>, String> {
    let result = match expr {
        NumericExpression::Constant(n) => Some(*n),
        NumericExpression::Expression(
            NumericOperation::Width
            | NumericOperation::Height
            | NumericOperation::SlotWidth { .. }
            | NumericOperation::SlotHeight { .. },
        ) => None,
        NumericExpression::Expression(NumericOperation::Parameter { name }) => {
            match values.get(name) {
                Some(GraphicValue::Number(n)) => Some(*n),
                _ => return Err("Missing evaluated numeric parameter".into()),
            }
        }
        NumericExpression::Expression(NumericOperation::Select {
            condition,
            if_true,
            if_false,
        }) => {
            let selected = match condition {
                BooleanExpression::Constant(value) => *value,
                BooleanExpression::Expression(BooleanOperation::Equal { name, value }) => {
                    values.get(name) == Some(value)
                }
                BooleanExpression::Expression(BooleanOperation::Parameter { name }) => {
                    match values.get(name) {
                        Some(GraphicValue::Bool(value)) => *value,
                        _ => return Err("Missing evaluated Bool parameter".into()),
                    }
                }
            };
            number(if selected { if_true } else { if_false }, values)?
        }
        NumericExpression::Expression(op) => {
            let (left, right) = match op {
                NumericOperation::Add { left, right }
                | NumericOperation::Subtract { left, right }
                | NumericOperation::Multiply { left, right }
                | NumericOperation::Divide { left, right }
                | NumericOperation::Min { left, right }
                | NumericOperation::Max { left, right } => (left, right),
                _ => return Err("Invalid numeric expression".into()),
            };
            let a = number(left, values)?;
            let b = number(right, values)?;
            if matches!(op, NumericOperation::Divide { .. }) && b == Some(0.0) {
                return Err("Division by zero in evaluated graphics".into());
            }
            match (a, b) {
                (Some(a), Some(b)) => Some(match op {
                    NumericOperation::Add { .. } => a + b,
                    NumericOperation::Subtract { .. } => a - b,
                    NumericOperation::Multiply { .. } => a * b,
                    NumericOperation::Divide { .. } => a / b,
                    NumericOperation::Min { .. } => a.min(b),
                    NumericOperation::Max { .. } => a.max(b),
                    _ => return Err("Invalid numeric operation".into()),
                }),
                _ => None,
            }
        }
    };
    if let Some(n) = result {
        graphic_number(n)?;
    }
    Ok(result)
}
impl GraphicDefinitions<'_> {
    pub(crate) fn evaluated_size(
        &self,
        d: &SymbolDefinition,
        values: &Values,
    ) -> Result<(), String> {
        if let Some(size) = &d.size {
            for (min, preferred) in [
                (&size.minimum_width, &size.preferred_width),
                (&size.minimum_height, &size.preferred_height),
            ] {
                let minimum = number(min, values)?;
                let preferred = number(preferred, values)?;
                if minimum.is_some_and(|n| n <= 0.0)
                    || preferred.is_some_and(|n| n <= 0.0)
                    || matches!((minimum, preferred), (Some(a), Some(b)) if b < a)
                {
                    return Err("Unsatisfiable graphical size constraints".into());
                }
            }
        }
        Ok(())
    }
    pub(crate) fn evaluated_geometry(
        &self,
        part: &GraphicPart,
        values: &Values,
    ) -> Result<(), String> {
        for anchor in &part.anchors {
            for expr in [&anchor.x, &anchor.y] {
                number(expr, values)?;
            }
            if let (Some(x), Some(y)) = (number(&anchor.dx, values)?, number(&anchor.dy, values)?)
                && x == 0.0
                && y == 0.0
            {
                return Err("Zero evaluated anchor direction".into());
            }
        }
        match &part.content {
            GraphicContent::Frame { children, .. }
            | GraphicContent::Stack { children, .. }
            | GraphicContent::Overlay { children } => {
                for child in children {
                    self.evaluated_geometry(child, values)?;
                }
            }
            GraphicContent::Transform {
                x,
                y,
                rotate,
                scale_x,
                scale_y,
                child,
            } => {
                for expr in [x, y, rotate] {
                    number(expr, values)?;
                }
                for expr in [scale_x, scale_y] {
                    if number(expr, values)?.is_some_and(|n| n.abs() < 1e-9) {
                        return Err("Singular evaluated graphical transform".into());
                    }
                }
                self.evaluated_geometry(child, values)?;
            }
            GraphicContent::Geometry { geometry, .. } => {
                let (width, height) = match geometry {
                    GraphicGeometry::Rectangle { width, height, .. }
                    | GraphicGeometry::Ellipse { width, height }
                    | GraphicGeometry::Polyline { width, height, .. }
                    | GraphicGeometry::Path { width, height, .. } => (width, height),
                };
                for expr in [width, height] {
                    if number(expr, values)?.is_some_and(|n| n <= 0.0) {
                        return Err("Nonpositive evaluated geometry".into());
                    }
                }
                match geometry {
                    GraphicGeometry::Polyline { points, .. } => {
                        for p in points {
                            number(&p.x, values)?;
                            number(&p.y, values)?;
                        }
                    }
                    GraphicGeometry::Path { commands, .. } => {
                        for p in commands {
                            let expressions: Vec<&NumericExpression> = match p {
                                PathCommand::Move { x, y } | PathCommand::Line { x, y } => {
                                    vec![x, y]
                                }
                                PathCommand::Quadratic { cx, cy, x, y } => vec![cx, cy, x, y],
                                PathCommand::Cubic {
                                    cx1,
                                    cy1,
                                    cx2,
                                    cy2,
                                    x,
                                    y,
                                } => vec![cx1, cy1, cx2, cy2, x, y],
                                PathCommand::Close => vec![],
                            };
                            for expr in expressions {
                                number(expr, values)?;
                            }
                        }
                    }
                    _ => {}
                }
            }
            GraphicContent::Use {
                definition,
                parameters,
                ..
            } => {
                let d = self.definition(definition)?;
                let mut forwarded: Values = d
                    .parameters
                    .iter()
                    .map(|(name, p)| (name.clone(), p.default_value()))
                    .collect();
                for (name, expr) in parameters {
                    forwarded.insert(
                        name.clone(),
                        match expr {
                            ValueExpression::Constant { value } => value.clone(),
                            ValueExpression::Parameter { name } => {
                                values.get(name).ok_or("Missing forwarded value")?.clone()
                            }
                        },
                    );
                }
                self.evaluated_size(d, &forwarded)?;
                self.evaluated_geometry(&d.root, &forwarded)?;
            }
            _ => {}
        }
        Ok(())
    }
}
