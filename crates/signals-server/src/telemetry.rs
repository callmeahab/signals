use anyhow::{Context, Result};
use opentelemetry::trace::TracerProvider;
use opentelemetry_sdk::{trace::SdkTracerProvider, Resource};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// All exporter settings (endpoint, headers, timeout, TLS and resource attributes)
/// are read by the OTLP SDK. Application fields never contain client IPs, bodies,
/// passwords or Authorization headers.
pub fn init() -> Result<Option<SdkTracerProvider>> {
    let enabled = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").is_ok_and(|v| !v.trim().is_empty())
        || std::env::var("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").is_ok_and(|v| !v.trim().is_empty());
    let provider = if enabled {
        let protocol = std::env::var("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL")
            .or_else(|_| std::env::var("OTEL_EXPORTER_OTLP_PROTOCOL"))
            .unwrap_or_else(|_| "grpc".into());
        let exporter = match protocol.as_str() {
            "grpc" => opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .build()?,
            "http/protobuf" => opentelemetry_otlp::SpanExporter::builder()
                .with_http()
                .build()?,
            other => anyhow::bail!("Unsupported OTLP protocol: {other}; use grpc or http/protobuf"),
        };
        let resource = Resource::builder()
            .with_service_name(
                std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "signals".into()),
            )
            .build();
        Some(
            SdkTracerProvider::builder()
                .with_resource(resource)
                .with_batch_exporter(exporter)
                .build(),
        )
    } else {
        None
    };
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "signals=info,signals_server=info,tower_http=info".into());
    let otel = provider
        .as_ref()
        .map(|p| tracing_opentelemetry::layer().with_tracer(p.tracer("signals")));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(otel)
        .try_init()
        .context("initialize tracing")?;
    Ok(provider)
}
