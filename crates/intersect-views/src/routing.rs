//! Data-only M14 routing and bound-label placement contracts. Geometry stays in TS.
use serde::{Deserialize, Serialize};

pub const ROOT_ROUTE_FRAME: &str = "route:root";
pub const MAX_ROUTE_WAYPOINTS: usize = 32;
pub const MAX_ROUTED_EDGES: usize = 2048;
pub const ROUTING_EXTENT: f64 = 1_000_000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutingAlgorithm {
    Orthogonal,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrunkPolicy {
    None,
    Siblings,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutingPolicy {
    pub algorithm: RoutingAlgorithm,
    pub clearance: f64,
    pub stub_length: f64,
    pub trunks: TrunkPolicy,
}
impl Default for RoutingPolicy {
    fn default() -> Self {
        Self {
            algorithm: RoutingAlgorithm::Orthogonal,
            clearance: 8.0,
            stub_length: 18.0,
            trunks: TrunkPolicy::None,
        }
    }
}
impl RoutingPolicy {
    pub fn validate(&self) -> Result<(), String> {
        if !self.clearance.is_finite()
            || !(0.0..=64.0).contains(&self.clearance)
            || !self.stub_length.is_finite()
            || !(2.0..=128.0).contains(&self.stub_length)
            || self.stub_length < self.clearance + 2.0
        {
            return Err("Invalid orthogonal routing clearance or stub length".into());
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoutePoint {
    pub x: f64,
    pub y: f64,
}
impl RoutePoint {
    pub fn validate(&self) -> Result<(), String> {
        bounded_offset(self.x)?;
        bounded_offset(self.y)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteConstraint {
    pub frame: String,
    pub waypoints: Vec<RoutePoint>,
}
impl RouteConstraint {
    pub fn validate(&self) -> Result<(), String> {
        super::identity(&self.frame)?;
        if self.frame.len() > 256 || self.frame.chars().any(char::is_control) {
            return Err("Invalid route frame identity".into());
        }
        if self.waypoints.len() > MAX_ROUTE_WAYPOINTS {
            return Err("Manual route exceeds 32 waypoints".into());
        }
        for point in &self.waypoints {
            point.validate()?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum LabelPlacement {
    Owner {
        dx: f64,
        dy: f64,
    },
    Route {
        fraction: f64,
        #[serde(rename = "tangentOffset")]
        tangent_offset: f64,
        #[serde(rename = "normalOffset")]
        normal_offset: f64,
    },
}
impl LabelPlacement {
    pub fn validate(&self) -> Result<(), String> {
        match *self {
            Self::Owner { dx, dy } => {
                bounded_offset(dx)?;
                bounded_offset(dy)
            }
            Self::Route {
                fraction,
                tangent_offset,
                normal_offset,
            } => {
                if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
                    return Err("Invalid full-path label fraction".into());
                }
                bounded_offset(tangent_offset)?;
                bounded_offset(normal_offset)
            }
        }
    }
}
fn bounded_offset(value: f64) -> Result<(), String> {
    if value.is_finite() && value.abs() <= ROUTING_EXTENT {
        Ok(())
    } else {
        Err("Route or label coordinate exceeds the finite extent".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn routing_policy_has_required_closed_fields_and_exact_limits() {
        let policy: RoutingPolicy = serde_json::from_value(
            json!({"algorithm":"orthogonal","clearance":64,"stubLength":66,"trunks":"siblings"}),
        )
        .unwrap();
        assert!(policy.validate().is_ok());
        for value in [
            json!({"algorithm":"spline","clearance":8,"stubLength":18,"trunks":"none"}),
            json!({"algorithm":"orthogonal","clearance":8,"stubLength":18}),
            json!({"algorithm":"orthogonal","clearance":8,"stubLength":18,"trunks":"none","callback":"code"}),
        ] {
            assert!(serde_json::from_value::<RoutingPolicy>(value).is_err());
        }
        for (clearance, stub_length) in [
            (65.0, 80.0),
            (-1.0, 18.0),
            (8.0, 9.0),
            (0.0, 129.0),
            (f64::NAN, 18.0),
            (8.0, f64::INFINITY),
        ] {
            assert!(
                RoutingPolicy {
                    clearance,
                    stub_length,
                    ..RoutingPolicy::default()
                }
                .validate()
                .is_err()
            );
        }
    }
    #[test]
    fn manual_routes_keep_a_frame_and_bounded_ordered_points() {
        let mut route = RouteConstraint {
            frame: ROOT_ROUTE_FRAME.into(),
            waypoints: vec![RoutePoint { x: 1.0, y: 2.0 }; 32],
        };
        assert!(route.validate().is_ok());
        route.waypoints.push(RoutePoint { x: 0.0, y: 0.0 });
        assert!(route.validate().is_err());
        route.waypoints = vec![RoutePoint {
            x: 1_000_001.0,
            y: 0.0,
        }];
        assert!(route.validate().is_err());
        assert!(
            serde_json::from_value::<RouteConstraint>(
                json!({"frame":"route:root","waypoints":[],"source":"replacement"})
            )
            .is_err()
        );
    }
    #[test]
    fn owner_and_full_path_labels_are_distinct_closed_placements() {
        for value in [
            json!({"kind":"owner","dx":-20,"dy":30}),
            json!({"kind":"route","fraction":1,"tangentOffset":12,"normalOffset":-5}),
        ] {
            let placement: LabelPlacement = serde_json::from_value(value).unwrap();
            assert!(placement.validate().is_ok());
        }
        for value in [
            json!({"kind":"owner","dx":1,"dy":2,"fraction":0.5}),
            json!({"kind":"route","fraction":0.5,"normalOffset":2}),
            json!({"kind":"nearbySegment","fraction":0.5}),
        ] {
            assert!(serde_json::from_value::<LabelPlacement>(value).is_err());
        }
        assert!(
            LabelPlacement::Route {
                fraction: 1.01,
                tangent_offset: 0.0,
                normal_offset: 0.0
            }
            .validate()
            .is_err()
        );
        assert!(
            LabelPlacement::Owner {
                dx: f64::INFINITY,
                dy: 0.0
            }
            .validate()
            .is_err()
        );
    }
}
