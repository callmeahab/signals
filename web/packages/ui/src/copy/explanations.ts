// Every info popover's copy, in one file, keyed by card or tile id so a reviewer can
// read the whole product's explanations in one place and check them against
// `docs/analytics.md` and `briefs/v2/analytics-api.md`.
//
// Ids are `<screen>.tile.<slug>` for tiles and `<screen>.card.<slug>` for cards.
// Each entry is two or three short sentences for a manager: what the number is, how
// it is computed (window, identity precedence, SLO class, estimate against exact),
// and what a bad value means or what to do about it.
//
// Vocabulary used throughout, so every entry can stay short:
//   "the window"  — the selected range (24 hours, 7, 30 or 90 days), half-open and in UTC.
//   "the prior window" — the same length immediately before it; every delta chip uses it.
//   "an identity" — OAuth subject first, then the caller key, then a hashed network
//                   address. Kinds never merge, and raw IP addresses are never stored.
//   "a call"      — one `tool.called` event. Nothing else counts as a call.
//   "estimated"   — derived from payload size, not measured; see the Cost screen.

/**
 * What a card or tile may quote from the project it is being shown for. An entry that
 * states a number a reader can change — an SLO target today — is a function of this, so
 * the explanation cannot drift from the tile above it.
 */
export type ExplainContext = { sloTargets?: { read: number; mutate: number } };
export type ExplanationFields = { title: string; body: string; computed: string; action?: string };
export type Explanation = ExplanationFields | ((context: ExplainContext) => ExplanationFields);
export type Explanations = Record<string, Explanation>;

// The collector's own defaults, for a host that has not fetched the project's targets yet.
const DEFAULT_TARGETS = { read: 99.5, mutate: 98 };
// Targets read as "99.5%" and "80%", never "99.50%": the saved value, as saved.
const target = (n: number) => `${n}%`;

export const explanations: Explanations = {
 /* ------------------------------------------------------------------ Overview */
 'overview.tile.tool-calls':
  { title: 'Tool calls', body: 'Every tool call in the window — `tool.called` events only, not protocol requests or resource reads.', computed: 'The chip compares the same length of time immediately before.', action: 'Calls falling while sessions hold steady usually means clients connect but find nothing worth calling.' },
 'overview.tile.active-users':
  { title: 'Active users', body: 'Distinct identities that sent any event in the window.', computed: 'An identity is the OAuth subject when there is one, otherwise the caller key, otherwise a hashed network address — so network-only identities are an approximation, not named people.', action: 'A high network-only count means you cannot yet attribute usage; issue per-client keys or turn on OAuth.' },
 'overview.tile.sessions':
  { title: 'Sessions', body: 'Sessions whose first event falls in the window, and the average number of calls in each.', computed: 'Counts session starts in the selected window; calls per session divides their calls by their session count.', action: 'Many sessions with very few calls each is a reconnect loop or a client that gives up after the handshake.' },
 'overview.tile.tool-success': ({ sloTargets: t = DEFAULT_TARGETS }) =>
  ({ title: 'Tool success', body: `Share of calls in the window that did not report an error.`, computed: `Each tool is judged against its own class target — ${target(t.read)} for read tools, ${target(t.mutate)} for anything that mutates — and the caption counts the tools currently below theirs.`, action: `Anything below target is spending error budget; Reliability shows how fast.` }),
 'overview.tile.p95-latency':
  { title: 'p95 latency', body: 'The call duration that 95% of calls in the window beat.', computed: 'Percentiles come from log-spaced histograms, so the figure is accurate to within about 26%; windows under six hours are exact instead.', action: 'The trend is the one series that follows the window -- hourly up to 48 hours, daily after -- and p95 far above p50 means a slow minority, which is what users actually notice.' },
 'overview.tile.context-tokens':
  { title: 'Context tokens', body: 'Estimated tokens your tool responses added to the model context in the window.', computed: 'It is output characters where the SDK reports them, otherwise output bytes, divided by the project token divisor (4 by default) — an estimate, never a provider invoice.', action: 'Rising tokens per call means responses are getting more expensive to read.' },
 'overview.card.calls-by-client':
  { title: 'Calls by client', body: 'Tool calls per UTC day, stacked by MCP client name, over the window.', computed: 'The collector emits one point per UTC date that has calls and leaves out the dates with none, so a 24-hour window can span two dates and a 90-day window has as many columns as it has days with calls.', action: 'One client growing while the total is flat is a migration, not growth.' },
 'overview.card.client-mix':
  { title: 'Client mix', body: 'Each client\'s share of tool calls in the window, to one decimal; session counts are independent of it.', computed: 'Arcs are drawn from raw call counts and a client with no calls gets no arc.', action: 'Use it to see which client to test against first.' },
 'overview.card.activation-funnel':
  { title: 'Activation funnel', body: 'Of the identities first seen in this window, how many connected, listed your tools, made a first call, made five, and came back a week later.', computed: 'Day 7 counts only identities old enough to have had the chance, so it reads "waiting" on a young project rather than zero.', action: 'The biggest drop is where to spend documentation effort.' },
 'overview.card.weekly-retention':
  { title: 'Weekly retention', body: 'Each row is a weekly cohort of identities, and each column is the share of that cohort still active N weeks later.', computed: 'Cohorts start on Monday in UTC, and an unfinished week is blank rather than low.', action: 'Columns fading fast means first calls are not turning into habits.' },
 'overview.card.attention': ({ sloTargets: t = DEFAULT_TARGETS }) =>
  ({ title: 'Tools needing attention', body: `Every tool that is failing its class target, within a point of it, or advertised but never called in the window.`, computed: `Read tools target ${target(t.read)} success, mutating tools ${target(t.mutate)}, and the class comes from your settings, then catalogue annotations, then the tool name.`, action: `Start at the top: that row is burning the most error budget.` }),

 /* ------------------------------------------------------------------ Adoption */
 'adoption.tile.dau':
  { title: 'DAU', body: 'Distinct identities active on the most recent day of the window.', computed: 'Identity is the OAuth subject, then the caller key, then a hashed network address, so this is people-or-machines, not sessions.', action: 'The sparkline shows whether today is typical.' },
 'adoption.tile.wau':
  { title: 'WAU', body: 'Distinct identities active in the seven days ending at the window end.', computed: 'It is a rolling count, so it reaches back behind the window start and is always at least the daily figure.', action: 'Flat WAU with rising DAU means the same few identities are just busier.' },
 'adoption.tile.mau':
  { title: 'MAU', body: 'Distinct identities active in the 30 days ending at the window end, counted the same way as WAU.', computed: 'It is the denominator for stickiness and the widest honest measure of reach.', action: 'If it is barely above WAU, almost nobody arrived more than a week ago.' },
 'adoption.tile.stickiness':
  { title: 'Stickiness', body: 'Daily actives divided by monthly actives, as a percentage — how much of your audience shows up on an average day.', computed: 'Both counts use the same identity rules.', action: 'Under about 10% means an occasional tool; above 25% means something people keep open.' },
 'adoption.tile.new-users':
  { title: 'New users', body: 'Identities whose first ever event falls inside this window, summed across its buckets.', computed: 'They are the input to the activation funnel, so compare this with how many reached a first call.', action: 'New users arriving but not converting is a setup problem, not a demand problem.' },
 'adoption.tile.d7-retention':
  { title: 'D7 retention', body: 'Share of daily cohorts that came back exactly seven UTC days after they were first seen.', computed: 'Only identities old enough to have had that day are counted, so the figure never dips just because the project is young.', action: 'The chip shows day 1 and day 30 next to it for shape.' },
 'adoption.card.active-identities':
  { title: 'Active identities', body: 'Active identities per UTC day, split into those first seen in this window and those seen before it.', computed: 'Buckets are UTC days on every range; only the latency series on Reliability changes with the window.', action: 'A stack that is almost all new means you acquire but do not keep.' },
 'adoption.card.identity-quality':
  { title: 'Identity quality', body: 'How confidently each active identity can be named: strong is an OAuth subject, key is a caller key, network is a hashed address.', computed: 'Precedence is strong, then key, then network, and kinds never merge, so the three add up to active users.', action: 'The more weight in network, the less any per-user number on this screen can be trusted.' },
 'adoption.card.clients':
  { title: 'Clients', body: 'Every MCP client and version that connected in the window, with its share of tool calls, session count and the capabilities it declared at initialization.', computed: 'Share is calls divided by all calls in the window, to one decimal, so it is independent of session counts.', action: 'Old versions clustering here are the ones to keep supporting.' },
 'adoption.card.transport-protocol':
  { title: 'Transport and protocol', body: 'Sessions by wire transport and by the protocol revision the handshake agreed.', computed: 'Both are counted per session in the window, and the revision list grows as clients adopt newer specs.', action: 'A long tail of old revisions limits which protocol features you can rely on.' },
 'adoption.card.conversion':
  { title: 'Conversion', body: 'The activation funnel as a curve: each step as a percentage of the identities that connected.', computed: 'The curve stops at the last step that has a count, so a step still waiting for data does not plot as a fall to zero.', action: 'The steepest segment is the one to fix first.' },

 /* --------------------------------------------------------------------- Tools */
 'tools.tile.advertised':
  { title: 'Advertised', body: 'How many tools the latest `tools/list` snapshot advertised.', computed: 'It comes from the newest successful snapshot in event time; a failed listing never replaces a good one.', action: '"No data yet" means no client has listed your tools, so coverage below cannot be judged.' },
 'tools.tile.used':
  { title: 'Used', body: 'Tools called at least once in the window.', computed: 'With a complete catalogue this counts catalogue members only; calls to names outside it are counted as hallucinated instead.', action: 'Used far below advertised means most of your surface area is dead weight.' },
 'tools.tile.never-called':
  { title: 'Never called', body: 'Catalogue members with no calls in the window.', computed: 'It is only meaningful when the snapshot is complete — a truncated snapshot cannot prove a tool was unused, so this reads unknown.', action: 'Tools that are never called are candidates for better descriptions or removal.' },
 'tools.tile.retries':
  { title: 'Retries', body: 'Calls that repeated the same tool in the same session within 30 seconds of a failure.', computed: 'Other calls may come in between, and a retry that succeeds counts as self-corrected.', action: 'A high count means the model is working around your tool rather than being served by it.' },
 'tools.tile.below-slo': ({ sloTargets: t = DEFAULT_TARGETS }) =>
  ({ title: 'Below SLO', body: `Tools whose success rate in the window is under their class target: ${target(t.read)} for read tools, ${target(t.mutate)} for mutating ones.`, computed: `The class comes from your settings first, then catalogue read-only or destructive annotations, then the name prefix.`, action: `Each tool here is spending error budget right now.` }),
 'tools.tile.hallucinated':
  { title: 'Hallucinated', body: 'Calls to tool names your server does not advertise, plus every explicit unknown-tool error.', computed: 'With a complete catalogue, any name outside it counts; with a truncated one, only the explicit errors do.', action: 'Recurring invented names usually mean a prompt or description is promising a tool you do not have.' },
 'tools.card.paths':
  { title: 'Top tool paths', body: 'The most common consecutive runs of tool calls inside a single session — pairs and triples, top 20 by count.', computed: 'Shares use every observed pair and triple as the denominator, and runs that cross midnight are kept.', action: 'These are the journeys worth making fast.' },
 'tools.card.health': ({ sloTargets: t = DEFAULT_TARGETS }) =>
  ({ title: 'Tool health', body: `Every tool's success rate against its class target, worst first, with its call volume.`, computed: `Read tools target ${target(t.read)}, mutating tools ${target(t.mutate)}, and a tool advertised but never called in the window reads dead.`, action: `The bars below their tick are where your error budget is going.` }),
 'tools.card.latency':
  { title: 'Latency distribution', body: 'Distribution of call durations across all tools in the window, in log-spaced buckets about 1.26 apart.', computed: 'Markers show p50, p95 and p99 from the same histogram, so each is accurate to within about 26%.', action: 'A second hump to the right is a slow path, not noise.' },
 'tools.card.catalogue':
  { title: 'Catalogue', body: 'What the latest `tools/list` snapshot advertised against what was actually called in the window, with the snapshot hash and the time it was taken.', computed: 'When the snapshot is incomplete, coverage and the never-called list are unknown rather than empty.', action: 'A stale timestamp means no client has listed your tools recently.' },
 'tools.card.performance':
  { title: 'Tool performance', body: 'One row per tool for the window: calls, success against its class target, latency percentiles, average payload sizes, estimated tokens and error counts.', computed: 'A dash means the SDKs have not reported that error class yet, which is different from zero.', action: 'Select a row for that tool\'s own trend, histogram and error split.' },

 /* --------------------------------------------------- Tool drawer (per tool) */
 'tool.tile.calls':
  { title: 'Calls', body: 'Calls to this one tool inside the selected window.', computed: 'Only `tool.called` events count.', action: 'Compare it with the tool\'s share of the paths chart to see whether it is a destination or a step.' },
 'tool.tile.success': ({ sloTargets: t = DEFAULT_TARGETS }) =>
  ({ title: 'Success', body: `Share of this tool's calls that did not report an error, against its class target — ${target(t.read)} for read tools, ${target(t.mutate)} for mutating ones.`, computed: `The class shown beside it is the one actually in force, from your settings, the catalogue, or the name.`, action: `Below target means this tool is the one spending budget.` }),
 'tool.tile.p95':
  { title: 'p95', body: 'The duration 95% of this tool\'s calls beat, in milliseconds, from its own log-spaced histogram.', computed: 'Accuracy is within about 26% of the value; windows under six hours are computed exactly.', action: 'Treat p95, not the average, as what callers feel.' },
 'tool.card.calls-errors':
  { title: 'Calls and errors', body: 'This tool\'s successful calls and errors per UTC day over the window, stacked.', computed: 'A tool\'s trend is grouped by day whatever the range, and a day with no calls is simply absent.', action: 'Errors arriving in a block rather than a trickle point at a dependency, not the tool.' },
 'tool.card.latency':
  { title: 'Latency distribution', body: 'This tool\'s own call durations, in log-spaced buckets about 1.26 apart, with its p50, p95 and p99 marked.', computed: 'Counts add up to the tool\'s measured calls in the window.', action: 'A long right tail with a healthy p50 means a slow input, not a slow tool.' },
 'tool.card.error-split':
  { title: 'Error split', body: 'This tool\'s errors by class: tool, protocol, timeout, cancelled and unknown.', computed: 'Every class except tool stays blank until the SDK reports an error kind, so a dash is "not reported yet", not zero.', action: 'Timeouts and protocol errors are usually yours to fix; cancellations are the client changing its mind.' },

 /* --------------------------------------------------------------- Reliability */
 'reliability.tile.handshake':
  { title: 'Handshake', body: 'Initialize attempts in the window and the share that succeeded.', computed: 'Success rate and p95 stay blank until the SDK reports initialize outcomes, so attempts alone can be the only measured figure.', action: 'Failing handshakes mean clients never reach your tools at all.' },
 'reliability.tile.timeouts':
  { title: 'Timeouts', body: 'Calls the SDK classified as timed out in the window.', computed: 'It stays blank until events carry an error kind, which is different from a measured zero.', action: 'Timeouts concentrated in one tool point at an upstream dependency.' },
 'reliability.tile.cancellations':
  { title: 'Cancellations', body: 'Calls the client abandoned before your server answered, and their share of all calls.', computed: 'A result that arrives after a cancellation is counted as a silent failure instead.', action: 'Rising cancellations usually mean calls are slower than the client is willing to wait.' },
 'reliability.tile.sessions-with-errors':
  { title: 'Sessions with errors', body: 'Sessions in the window with at least one failed call, and their share of all sessions.', computed: 'One bad tool can put an error in most sessions, so read it next to Tool health.', action: 'It is the closest thing here to "how many conversations went wrong".' },
 'reliability.tile.silent-failures':
  { title: 'Silent failures', body: 'Calls that reported success with no output at all, plus results delivered after the client cancelled.', computed: 'The model cannot tell these from an empty answer, so they look like your tool had nothing to say.', action: 'Any number here is worth a look.' },
 'reliability.tile.hallucinated-tools':
  { title: 'Hallucinated tools', body: 'Calls to names your server does not advertise, with the names themselves.', computed: 'With a complete catalogue every outside name counts; with a truncated one only explicit unknown-tool errors do.', action: 'The names are a reading list for your prompts and tool descriptions.' },
 'reliability.card.error-budget':
  { title: 'Error budget', body: 'For each SLO class, how much of the allowed failure for the window is left, and how fast it is being spent.', computed: 'The arc is budget remaining, the needle is the one-hour burn rate, and the red tick is the burn your error-budget alert rule fires on, as saved in Settings.', action: 'Needle past the tick means act now, not at the next review.' },
 'reliability.card.latency-over-time':
  { title: 'Latency over time', body: 'p50, p95 and p99 across all tools per bucket, hourly for windows up to 48 hours and daily beyond.', computed: 'Daily percentiles come from merged histograms, never from averaging hourly ones.', action: 'The band widening while p50 holds means the tail is getting worse, which is what users report.' },
 'reliability.card.success-by-class':
  { title: 'Success by class', body: 'Success rate per SLO class against its target, with the share of error budget still unspent.', computed: 'Read tools target 99.5% and mutating tools 98%; the classes themselves are set in Settings.', action: 'A class under target with budget left is a warning; under target with none is an incident.' },
 'reliability.card.error-codes':
  { title: 'Error codes', body: 'JSON-RPC error codes behind the failed calls in the window, by count.', computed: 'It stays empty until the SDKs report codes, which is different from having no errors.', action: 'Invalid-params codes are usually a schema mismatch you own.' },
 'reliability.card.auth-failures':
  { title: 'Authentication failures', body: 'Requests rejected before a session existed, grouped by reason — invalid, expired, missing or out of scope.', computed: 'These never appear as session or call errors, because there was no session yet.', action: 'A spike in one reason is a client misconfiguration, not an attack.' },
 'reliability.card.availability':
  { title: 'Availability', body: 'Share of synthetic probes in the window that succeeded, one dot per probe.', computed: 'Probing runs only once both a probe URL and key are set in Settings, and it performs initialize plus `tools/list`, never your tools.', action: 'Healthy tools stays blank because discovery does not execute anything.' },

 /* ------------------------------------------------------------------ Sessions */
 'sessions.tile.sessions':
  { title: 'Sessions', body: 'Sessions whose first event falls inside the window, and the average calls in each.', computed: 'Per-bucket counts add up exactly to this number.', action: 'Depth near one call per session means clients connect and leave.' },
 'sessions.tile.with-errors':
  { title: 'With errors', body: 'Sessions in the window containing at least one failed call.', computed: 'One failing tool can appear in most sessions, so compare it with Tool health before blaming the transport.' },
 'sessions.tile.cancelled':
  { title: 'Cancelled', body: 'Calls the client abandoned mid-flight in the window.', computed: 'Cancellations are the client\'s decision, usually about how long it was prepared to wait.', action: 'Read them next to p95 latency.' },
 'sessions.tile.streamable-http':
  { title: 'streamable-http', body: 'Sessions in the window that used the streamable HTTP transport — the remote path, and normally the majority.', computed: 'Transport is recorded per session at session start.', action: 'A sudden fall here with stdio rising means traffic moved to local clients.' },
 'sessions.tile.stdio':
  { title: 'stdio', body: 'Sessions in the window that used stdio, which means a locally launched server: desktop clients and development.', computed: 'These sessions never traverse your network, so availability probes say nothing about them.' },
 'sessions.tile.open':
  { title: 'Open on this page', body: 'Sessions on this page with no `session.ended` event yet.', computed: 'Long-lived clients legitimately sit here; so does a client that crashed without closing.', action: 'Combine with the duration column before reading too much into it.' },
 'sessions.card.replay':
  { title: 'Session replay', body: 'The newest session, one lane per target, with every event placed at its offset from the session start.', computed: 'Bar length is the call\'s measured duration and red marks a reported error.', action: 'It is the fastest way to see which call blocked the rest.' },
 'sessions.card.table':
  { title: 'The story of a connection', body: 'Newest sessions first, with client, identity, duration, call depth, errors and how the session ended.', computed: 'Identity follows the usual precedence: OAuth subject, then caller key, then hashed network address.', action: 'Select a row to replay that one connection event by event.' },
 'sessions.card.by-client':
  { title: 'Sessions by client', body: 'Sessions in the window held by each MCP client.', computed: 'It counts sessions, not calls, so a chatty client can be small here and large on the Overview mix.', action: 'A client with many sessions and few calls is probably reconnecting.' },

 /* ------------------------------------------------------------------- Callers */
 'callers.card.table':
  { title: 'A name behind every connection', body: 'Every identity that produced activity in the window, with its kind, call and session counts, clients and error rate.', computed: 'Kind is strong for an OAuth subject, key for a caller key, network for a hashed address, and the kinds never merge into one another.', action: 'Network rows cannot be contacted or billed; issue keys to turn them into names.' },
 'callers.card.billing':
  { title: 'Monthly tenant usage', body: 'Estimated context tokens and calls per identity, by calendar month.', computed: 'Tokens are output characters or bytes divided by the project token divisor, so they are an estimate for chargeback, not an invoice.', action: 'One identity dominating a month is usually a batch job, not a user.' },

 /* ---------------------------------------------------------------------- Cost */
 'cost.tile.context-tokens':
  { title: 'Context tokens', body: 'Estimated tokens your responses added to model context in the window.', computed: 'Output characters are used where the SDK reports them, otherwise output bytes, divided by the project token divisor (4 by default).', action: 'Every figure on this screen is an estimate, not a provider bill.' },
 'cost.tile.per-call':
  { title: 'Per call', body: 'Estimated tokens the average call adds to the context, that is total estimated tokens divided by calls.', computed: 'It moves when responses get larger or when the token divisor is changed in Settings.', action: 'Above roughly a thousand, one call is eating a noticeable part of the context window.' },
 'cost.tile.heaviest-tool':
  { title: 'Heaviest tool', body: 'The single tool responsible for the largest share of estimated tokens in the window, and that share.', computed: 'Share is tokens, not calls, so a rarely called tool can top it with large responses.', action: 'This is the first place to trim an output schema.' },
 'cost.tile.tenants':
  { title: 'Tenants', body: 'Identities that produced at least one billable call in the window.', computed: 'Identity is the OAuth subject, then the caller key, then a hashed network address, so network-only rows cannot be billed to anyone.', action: 'Few tenants carrying most of the cost is a chargeback conversation.' },
 'cost.tile.largest-payload':
  { title: 'Largest payload', body: 'Responses in the largest payload band for the window.', computed: 'Bands are fixed at 1 KB, 4 KB, 16 KB and 64 KB, with each boundary counted in the larger band.', action: 'Anything living in the top band is worth paginating or summarising.' },
 'cost.tile.billing-period':
  { title: 'Billing period', body: 'The most recent calendar month with usage, and how many identities it covers.', computed: 'Periods are UTC months and the current one is month to date, so it is always incomplete.', action: 'Use it to line usage up with your own billing cycle.' },
 'cost.card.treemap':
  { title: 'Where the context goes', body: 'Estimated tokens by tool, each area proportional to its share of the window.', computed: 'Tokens are output characters or bytes divided by the project token divisor, so this is where context goes, not what it costs in money.', action: 'The largest tiles are where an output schema change pays back most.' },
 'cost.card.payload-sizes':
  { title: 'Payload sizes', body: 'How many calls in the window landed in each payload size band, for inputs and for outputs.', computed: 'Boundaries are 1 KB, 4 KB, 16 KB and 64 KB, and each boundary counts in the larger band.', action: 'Outputs sitting far right of inputs means your server amplifies every request.' },
 'cost.card.by-tenant':
  { title: 'By tenant', body: 'Estimated tokens per identity in the window, largest first.', computed: 'Identity follows the usual precedence, so network-only rows are approximate and cannot be billed.', action: 'It answers who is spending the context budget.' },
 'cost.card.billing-periods':
  { title: 'Billing periods', body: 'Calls and estimated tokens per identity per calendar month, with each row\'s share of the window\'s tokens.', computed: 'Months are UTC and the newest one is still accumulating.', action: 'Shares are unavailable rather than zero when nothing was measured.' },

 /* ------------------------------------------------------------------ Protocol */
 'protocol.tile.sessions':
  { title: 'Sessions', body: 'Sessions in the window where a capability exchange was actually observed at initialization.', computed: 'It is the denominator for every share on this screen.', action: 'Well below your session count means many clients are not reporting their handshake.' },
 'protocol.tile.client-capabilities':
  { title: 'Client capabilities', body: 'How many distinct capabilities clients declared to you during the window, such as sampling or roots.', computed: 'Each is counted once per session that declared it.', action: 'These are the features you may rely on when a client is present.' },
 'protocol.tile.server-capabilities':
  { title: 'Server capabilities', body: 'How many distinct capabilities your own server declared during the window.', computed: 'Advertising something no client uses is harmless; advertising something you do not implement is not.', action: 'Compare with the matrix below.' },
 'protocol.tile.sampling':
  { title: 'Sampling', body: 'Server-to-client sampling requests observed in the window.', computed: 'It stays blank until the SDKs send sampling events, which is not the same as zero requests.', action: 'Once populated, rejection rate is the number to watch.' },
 'protocol.tile.elicitation':
  { title: 'Elicitation', body: 'Elicitation requests — your server asking the user for input — observed in the window.', computed: 'Blank means the SDKs have not reported accept, decline or cancel actions yet.', action: 'High decline rates mean you are asking for the wrong thing.' },
 'protocol.tile.tasks':
  { title: 'Tasks', body: 'Long-running tasks observed in the window, counted as distinct session and task id pairs.', computed: 'Status counts come from observed transitions, so they can lag creation.', action: 'Blank means the SDKs are not reporting task lifecycle events yet.' },
 'protocol.card.capability-matrix':
  { title: 'Capability matrix', body: 'Which capabilities each side declared at initialization, as a share of the sessions where an exchange was observed.', computed: 'Each dot is 2% of those sessions, client row above server row.', action: 'A capability near zero is one you cannot build a feature on yet.' },
 'protocol.card.sampling':
  { title: 'Sampling', body: 'Sampling requests in the window, their p95 duration, the share rejected among requests that reported an outcome, and the models returned.', computed: 'Missing measurements stay blank rather than zero.', action: 'A high rejection share means clients are refusing the work you delegate.' },
 'protocol.card.elicitation':
  { title: 'Elicitation', body: 'Elicitation requests in the window with the share accepted, declined and cancelled.', computed: 'Percentages use only requests that reported an action, so they can be blank while a count exists.', action: 'Declines concentrated in one prompt mean that prompt is the problem.' },
 'protocol.card.tasks':
  { title: 'Tasks', body: 'Task lifecycle in the window: created, completed, failed and cancelled.', computed: 'Created counts distinct session and task ids observed; the others count observed transitions, so totals need not balance.', action: 'Failures without completions means tasks are being started and lost.' },
 'protocol.card.progress':
  { title: 'Progress', body: 'Calls that ran a second or longer, and the share of them that reported progress.', computed: 'Both stay blank until a call in the window carries progress events; an explicit zero is a real measurement.', action: 'Long calls without progress are the ones that look frozen to a user.' },

 /* ---------------------------------------------------------------------- Live */
 'live.card.events-per-second':
  { title: 'Events per second', body: 'Events arriving in each of the last 40 seconds, from the live stream rather than the analytics rollups.', computed: 'The headline is the most recent full second.', action: 'It is a liveness check, not a usage metric — use Overview for volume.' },
 'live.card.event-mix':
  { title: 'Event mix', body: 'The last 200 streamed events grouped by type, so you can see what your server is mostly doing right now.', computed: 'It is a rolling buffer, not a window, and pausing freezes it.', action: 'Nothing but session events means clients connect and never call.' },
 'live.card.errors-in-window':
  { title: 'Errors in window', body: 'How many of the last 200 streamed events were errors or failed calls.', computed: 'Counted from the stream, so it will not match Reliability, which uses the selected window.', action: 'A burst here is the earliest warning you get.' },
 'live.card.stream':
  { title: 'Expand an event to inspect its payload. Pause to hold the view steady.', body: 'Every event as it arrives, newest first, capped at the latest 200.', computed: 'Expand one for its full payload; pause to hold the view still while you read.', action: 'Filters apply to the buffer, so a quiet filter does not mean a quiet server.' },

 /* ------------------------------------------------------------------ Settings */
 'settings.card.alert-rules':
  { title: 'Alert rules', body: 'The five rules the collector evaluates every minute: volume against the preceding seven-day hourly average, p95 against the preceding 24 hours, error rate held above the threshold for 15 minutes, destructive calls from an unrecognised client, and error-budget burn.', computed: 'Only state changes are recorded, and a missing sample or a gap over 90 seconds resets a pending breach instead of firing.', action: 'Thresholds that are too tight here are the usual cause of alert fatigue.' },
 'settings.card.analytics-settings':
  { title: 'Analytics settings', body: 'The assumptions behind every number elsewhere: the success target for each SLO class, the divisor that turns output size into estimated tokens, the digest recipient, and the class of each tool.', computed: 'Changing the divisor rescales the whole Cost screen; changing a target moves error budget and the Tools below-SLO count.', action: 'The tool list appears only when a complete catalogue has been seen.' },
};

/**
 * The copy for one card or tile, or undefined when that id has no explanation. An entry
 * that quotes the project's own settings is a function of the context it is read in.
 */
export function explain(id: string, context: ExplainContext = {}): ExplanationFields | undefined {
 const entry = explanations[id];
 return typeof entry === 'function' ? entry(context) : entry;
}
