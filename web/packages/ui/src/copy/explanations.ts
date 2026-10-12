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

export type Explanations = Record<string, string>;

export const explanations: Explanations = {
 /* ------------------------------------------------------------------ Overview */
 'overview.tile.tool-calls':
  'Every tool call in the window — `tool.called` events only, not protocol requests or resource reads. The chip compares the same length of time immediately before. Calls falling while sessions hold steady usually means clients connect but find nothing worth calling.',
 'overview.tile.active-users':
  'Distinct identities that sent any event in the window. An identity is the OAuth subject when there is one, otherwise the caller key, otherwise a hashed network address — so network-only identities are an approximation, not named people. A high network-only count means you cannot yet attribute usage; issue per-client keys or turn on OAuth.',
 'overview.tile.sessions':
  'Sessions whose first event falls in the window, and the average number of calls in each. Many sessions with very few calls each is a reconnect loop or a client that gives up after the handshake.',
 'overview.tile.tool-success':
  'Share of calls in the window that did not report an error. Each tool is judged against its own class target — 99.5% for read tools, 98% for anything that mutates — and the caption counts the tools currently below theirs. Anything below target is spending error budget; Reliability shows how fast.',
 'overview.tile.p95-latency':
  'The call duration that 95% of calls in the window beat. Percentiles come from log-spaced histograms, so the figure is accurate to within about 26%; windows under six hours are exact instead. p95 far above p50 means a slow minority, which is what users actually notice.',
 'overview.tile.context-tokens':
  'Estimated tokens your tool responses added to the model context in the window. It is output characters where the SDK reports them, otherwise output bytes, divided by the project token divisor (4 by default) — an estimate, never a provider invoice. Rising tokens per call means responses are getting more expensive to read.',
 'overview.card.calls-by-client':
  'Tool calls per bucket, stacked by MCP client name, over the window in UTC. Buckets follow the range: hourly for 24 hours, daily up to 30 days, weekly for 90. One client growing while the total is flat is a migration, not growth.',
 'overview.card.client-mix':
  'Each client\'s share of tool calls in the window, to one decimal; session counts are independent of it. Arcs are drawn from raw call counts and a client with no calls gets no arc. Use it to see which client to test against first.',
 'overview.card.activation-funnel':
  'Of the identities first seen in this window, how many connected, listed your tools, made a first call, made five, and came back a week later. Day 7 counts only identities old enough to have had the chance, so it reads "waiting" on a young project rather than zero. The biggest drop is where to spend documentation effort.',
 'overview.card.weekly-retention':
  'Each row is a weekly cohort of identities, and each column is the share of that cohort still active N weeks later. Cohorts start on Monday in UTC, and an unfinished week is blank rather than low. Columns fading fast means first calls are not turning into habits.',
 'overview.card.attention':
  'Every tool that is failing its class target, within a point of it, or advertised but never called in the window. Read tools target 99.5% success, mutating tools 98%, and the class comes from your settings, then catalogue annotations, then the tool name. Start at the top: that row is burning the most error budget.',

 /* ------------------------------------------------------------------ Adoption */
 'adoption.tile.dau':
  'Distinct identities active on the most recent day of the window. Identity is the OAuth subject, then the caller key, then a hashed network address, so this is people-or-machines, not sessions. The sparkline shows whether today is typical.',
 'adoption.tile.wau':
  'Distinct identities active in the seven days ending at the window end. It is a rolling count, so it reaches back behind the window start and is always at least the daily figure. Flat WAU with rising DAU means the same few identities are just busier.',
 'adoption.tile.mau':
  'Distinct identities active in the 30 days ending at the window end, counted the same way as WAU. It is the denominator for stickiness and the widest honest measure of reach. If it is barely above WAU, almost nobody arrived more than a week ago.',
 'adoption.tile.stickiness':
  'Daily actives divided by monthly actives, as a percentage — how much of your audience shows up on an average day. Both counts use the same identity rules. Under about 10% means an occasional tool; above 25% means something people keep open.',
 'adoption.tile.new-users':
  'Identities whose first ever event falls inside this window, summed across its buckets. They are the input to the activation funnel, so compare this with how many reached a first call. New users arriving but not converting is a setup problem, not a demand problem.',
 'adoption.tile.d7-retention':
  'Share of daily cohorts that came back exactly seven UTC days after they were first seen. Only identities old enough to have had that day are counted, so the figure never dips just because the project is young. The chip shows day 1 and day 30 next to it for shape.',
 'adoption.card.active-identities':
  'Active identities per bucket, split into those first seen in this window and those seen before it. Buckets are UTC days unless the range is 24 hours or 90 days. A stack that is almost all new means you acquire but do not keep.',
 'adoption.card.identity-quality':
  'How confidently each active identity can be named: strong is an OAuth subject, key is a caller key, network is a hashed address. Precedence is strong, then key, then network, and kinds never merge, so the three add up to active users. The more weight in network, the less any per-user number on this screen can be trusted.',
 'adoption.card.clients':
  'Every MCP client and version that connected in the window, with its share of tool calls, session count and the capabilities it declared at initialization. Share is calls divided by all calls in the window, to one decimal, so it is independent of session counts. Old versions clustering here are the ones to keep supporting.',
 'adoption.card.transport-protocol':
  'Sessions by wire transport and by the protocol revision the handshake agreed. Both are counted per session in the window, and the revision list grows as clients adopt newer specs. A long tail of old revisions limits which protocol features you can rely on.',
 'adoption.card.conversion':
  'The activation funnel as a curve: each step as a percentage of the identities that connected. The curve stops at the last step that has a count, so a step still waiting for data does not plot as a fall to zero. The steepest segment is the one to fix first.',

 /* --------------------------------------------------------------------- Tools */
 'tools.tile.advertised':
  'How many tools the latest `tools/list` snapshot advertised. It comes from the newest successful snapshot in event time; a failed listing never replaces a good one. "No data yet" means no client has listed your tools, so coverage below cannot be judged.',
 'tools.tile.used':
  'Tools called at least once in the window. With a complete catalogue this counts catalogue members only; calls to names outside it are counted as hallucinated instead. Used far below advertised means most of your surface area is dead weight.',
 'tools.tile.never-called':
  'Catalogue members with no calls in the window. It is only meaningful when the snapshot is complete — a truncated snapshot cannot prove a tool was unused, so this reads unknown. Tools that are never called are candidates for better descriptions or removal.',
 'tools.tile.retries':
  'Calls that repeated the same tool in the same session within 30 seconds of a failure. Other calls may come in between, and a retry that succeeds counts as self-corrected. A high count means the model is working around your tool rather than being served by it.',
 'tools.tile.below-slo':
  'Tools whose success rate in the window is under their class target: 99.5% for read tools, 98% for mutating ones. The class comes from your settings first, then catalogue read-only or destructive annotations, then the name prefix. Each tool here is spending error budget right now.',
 'tools.tile.hallucinated':
  'Calls to tool names your server does not advertise, plus every explicit unknown-tool error. With a complete catalogue, any name outside it counts; with a truncated one, only the explicit errors do. Recurring invented names usually mean a prompt or description is promising a tool you do not have.',
 'tools.card.paths':
  'The most common consecutive runs of tool calls inside a single session — pairs and triples, top 20 by count. Shares use every observed pair and triple as the denominator, and runs that cross midnight are kept. These are the journeys worth making fast.',
 'tools.card.health':
  'Every tool\'s success rate against its class target, worst first, with its call volume. Read tools target 99.5%, mutating tools 98%, and a tool advertised but never called in the window reads dead. The bars below their tick are where your error budget is going.',
 'tools.card.latency':
  'Distribution of call durations across all tools in the window, in log-spaced buckets about 1.26 apart. Markers show p50, p95 and p99 from the same histogram, so each is accurate to within about 26%. A second hump to the right is a slow path, not noise.',
 'tools.card.catalogue':
  'What the latest `tools/list` snapshot advertised against what was actually called in the window, with the snapshot hash and the time it was taken. When the snapshot is incomplete, coverage and the never-called list are unknown rather than empty. A stale timestamp means no client has listed your tools recently.',
 'tools.card.performance':
  'One row per tool for the window: calls, success against its class target, latency percentiles, average payload sizes, estimated tokens and error counts. A dash means the SDKs have not reported that error class yet, which is different from zero. Select a row for that tool\'s own trend, histogram and error split.',

 /* --------------------------------------------------- Tool drawer (per tool) */
 'tool.tile.calls':
  'Calls to this one tool inside the selected window. Only `tool.called` events count. Compare it with the tool\'s share of the paths chart to see whether it is a destination or a step.',
 'tool.tile.success':
  'Share of this tool\'s calls that did not report an error, against its class target — 99.5% for read tools, 98% for mutating ones. The class shown beside it is the one actually in force, from your settings, the catalogue, or the name. Below target means this tool is the one spending budget.',
 'tool.tile.p95':
  'The duration 95% of this tool\'s calls beat, in milliseconds, from its own log-spaced histogram. Accuracy is within about 26% of the value; windows under six hours are computed exactly. Treat p95, not the average, as what callers feel.',
 'tool.card.calls-errors':
  'This tool\'s successful calls and errors per bucket over the window, stacked. Buckets follow the range, in UTC. Errors arriving in a block rather than a trickle point at a dependency, not the tool.',
 'tool.card.latency':
  'This tool\'s own call durations, in log-spaced buckets about 1.26 apart, with its p50, p95 and p99 marked. Counts add up to the tool\'s measured calls in the window. A long right tail with a healthy p50 means a slow input, not a slow tool.',
 'tool.card.error-split':
  'This tool\'s errors by class: tool, protocol, timeout, cancelled and unknown. Every class except tool stays blank until the SDK reports an error kind, so a dash is "not reported yet", not zero. Timeouts and protocol errors are usually yours to fix; cancellations are the client changing its mind.',

 /* --------------------------------------------------------------- Reliability */
 'reliability.tile.handshake':
  'Initialize attempts in the window and the share that succeeded. Success rate and p95 stay blank until the SDK reports initialize outcomes, so attempts alone can be the only measured figure. Failing handshakes mean clients never reach your tools at all.',
 'reliability.tile.timeouts':
  'Calls the SDK classified as timed out in the window. It stays blank until events carry an error kind, which is different from a measured zero. Timeouts concentrated in one tool point at an upstream dependency.',
 'reliability.tile.cancellations':
  'Calls the client abandoned before your server answered, and their share of all calls. A result that arrives after a cancellation is counted as a silent failure instead. Rising cancellations usually mean calls are slower than the client is willing to wait.',
 'reliability.tile.sessions-with-errors':
  'Sessions in the window with at least one failed call, and their share of all sessions. One bad tool can put an error in most sessions, so read it next to Tool health. It is the closest thing here to "how many conversations went wrong".',
 'reliability.tile.silent-failures':
  'Calls that reported success with no output at all, plus results delivered after the client cancelled. The model cannot tell these from an empty answer, so they look like your tool had nothing to say. Any number here is worth a look.',
 'reliability.tile.hallucinated-tools':
  'Calls to names your server does not advertise, with the names themselves. With a complete catalogue every outside name counts; with a truncated one only explicit unknown-tool errors do. The names are a reading list for your prompts and tool descriptions.',
 'reliability.card.error-budget':
  'For each SLO class, how much of the allowed failure for the window is left, and how fast it is being spent. The arc is budget remaining, the needle is the one-hour burn rate, and the red tick is 6×, the burn the alert rule fires on. Needle past the tick means act now, not at the next review.',
 'reliability.card.latency-over-time':
  'p50, p95 and p99 across all tools per bucket, hourly for windows up to 48 hours and daily beyond. Daily percentiles come from merged histograms, never from averaging hourly ones. The band widening while p50 holds means the tail is getting worse, which is what users report.',
 'reliability.card.success-by-class':
  'Success rate per SLO class against its target, with the share of error budget still unspent. Read tools target 99.5% and mutating tools 98%; the classes themselves are set in Settings. A class under target with budget left is a warning; under target with none is an incident.',
 'reliability.card.error-codes':
  'JSON-RPC error codes behind the failed calls in the window, by count. It stays empty until the SDKs report codes, which is different from having no errors. Invalid-params codes are usually a schema mismatch you own.',
 'reliability.card.auth-failures':
  'Requests rejected before a session existed, grouped by reason — invalid, expired, missing or out of scope. These never appear as session or call errors, because there was no session yet. A spike in one reason is a client misconfiguration, not an attack.',
 'reliability.card.availability':
  'Share of synthetic probes in the window that succeeded, one dot per probe. Probing runs only once both a probe URL and key are set in Settings, and it performs initialize plus `tools/list`, never your tools. Healthy tools stays blank because discovery does not execute anything.',

 /* ------------------------------------------------------------------ Sessions */
 'sessions.tile.sessions':
  'Sessions whose first event falls inside the window, and the average calls in each. Per-bucket counts add up exactly to this number. Depth near one call per session means clients connect and leave.',
 'sessions.tile.with-errors':
  'Sessions in the window containing at least one failed call. One failing tool can appear in most sessions, so compare it with Tool health before blaming the transport.',
 'sessions.tile.cancelled':
  'Calls the client abandoned mid-flight in the window. Cancellations are the client\'s decision, usually about how long it was prepared to wait. Read them next to p95 latency.',
 'sessions.tile.streamable-http':
  'Sessions in the window that used the streamable HTTP transport — the remote path, and normally the majority. Transport is recorded per session at session start. A sudden fall here with stdio rising means traffic moved to local clients.',
 'sessions.tile.stdio':
  'Sessions in the window that used stdio, which means a locally launched server: desktop clients and development. These sessions never traverse your network, so availability probes say nothing about them.',
 'sessions.tile.open':
  'Sessions on this page with no `session.ended` event yet. Long-lived clients legitimately sit here; so does a client that crashed without closing. Combine with the duration column before reading too much into it.',
 'sessions.card.replay':
  'The newest session, one lane per target, with every event placed at its offset from the session start. Bar length is the call\'s measured duration and red marks a reported error. It is the fastest way to see which call blocked the rest.',
 'sessions.card.table':
  'Newest sessions first, with client, identity, duration, call depth, errors and how the session ended. Identity follows the usual precedence: OAuth subject, then caller key, then hashed network address. Select a row to replay that one connection event by event.',
 'sessions.card.by-client':
  'Sessions in the window held by each MCP client. It counts sessions, not calls, so a chatty client can be small here and large on the Overview mix. A client with many sessions and few calls is probably reconnecting.',

 /* ------------------------------------------------------------------- Callers */
 'callers.card.table':
  'Every identity that produced activity in the window, with its kind, call and session counts, clients and error rate. Kind is strong for an OAuth subject, key for a caller key, network for a hashed address, and the kinds never merge into one another. Network rows cannot be contacted or billed; issue keys to turn them into names.',
 'callers.card.billing':
  'Estimated context tokens and calls per identity, by calendar month. Tokens are output characters or bytes divided by the project token divisor, so they are an estimate for chargeback, not an invoice. One identity dominating a month is usually a batch job, not a user.',

 /* ---------------------------------------------------------------------- Cost */
 'cost.tile.context-tokens':
  'Estimated tokens your responses added to model context in the window. Output characters are used where the SDK reports them, otherwise output bytes, divided by the project token divisor (4 by default). Every figure on this screen is an estimate, not a provider bill.',
 'cost.tile.per-call':
  'Estimated tokens the average call adds to the context, that is total estimated tokens divided by calls. It moves when responses get larger or when the token divisor is changed in Settings. Above roughly a thousand, one call is eating a noticeable part of the context window.',
 'cost.tile.heaviest-tool':
  'The single tool responsible for the largest share of estimated tokens in the window, and that share. Share is tokens, not calls, so a rarely called tool can top it with large responses. This is the first place to trim an output schema.',
 'cost.tile.tenants':
  'Identities that produced at least one billable call in the window. Identity is the OAuth subject, then the caller key, then a hashed network address, so network-only rows cannot be billed to anyone. Few tenants carrying most of the cost is a chargeback conversation.',
 'cost.tile.largest-payload':
  'Responses in the largest payload band for the window. Bands are fixed at 1 KB, 4 KB, 16 KB and 64 KB, with each boundary counted in the larger band. Anything living in the top band is worth paginating or summarising.',
 'cost.tile.billing-period':
  'The most recent calendar month with usage, and how many identities it covers. Periods are UTC months and the current one is month to date, so it is always incomplete. Use it to line usage up with your own billing cycle.',
 'cost.card.treemap':
  'Estimated tokens by tool, each area proportional to its share of the window. Tokens are output characters or bytes divided by the project token divisor, so this is where context goes, not what it costs in money. The largest tiles are where an output schema change pays back most.',
 'cost.card.payload-sizes':
  'How many calls in the window landed in each payload size band, for inputs and for outputs. Boundaries are 1 KB, 4 KB, 16 KB and 64 KB, and each boundary counts in the larger band. Outputs sitting far right of inputs means your server amplifies every request.',
 'cost.card.by-tenant':
  'Estimated tokens per identity in the window, largest first. Identity follows the usual precedence, so network-only rows are approximate and cannot be billed. It answers who is spending the context budget.',
 'cost.card.billing-periods':
  'Calls and estimated tokens per identity per calendar month, with each row\'s share of the window\'s tokens. Months are UTC and the newest one is still accumulating. Shares are unavailable rather than zero when nothing was measured.',

 /* ------------------------------------------------------------------ Protocol */
 'protocol.tile.sessions':
  'Sessions in the window where a capability exchange was actually observed at initialization. It is the denominator for every share on this screen. Well below your session count means many clients are not reporting their handshake.',
 'protocol.tile.client-capabilities':
  'How many distinct capabilities clients declared to you during the window, such as sampling or roots. Each is counted once per session that declared it. These are the features you may rely on when a client is present.',
 'protocol.tile.server-capabilities':
  'How many distinct capabilities your own server declared during the window. Advertising something no client uses is harmless; advertising something you do not implement is not. Compare with the matrix below.',
 'protocol.tile.sampling':
  'Server-to-client sampling requests observed in the window. It stays blank until the SDKs send sampling events, which is not the same as zero requests. Once populated, rejection rate is the number to watch.',
 'protocol.tile.elicitation':
  'Elicitation requests — your server asking the user for input — observed in the window. Blank means the SDKs have not reported accept, decline or cancel actions yet. High decline rates mean you are asking for the wrong thing.',
 'protocol.tile.tasks':
  'Long-running tasks observed in the window, counted as distinct session and task id pairs. Status counts come from observed transitions, so they can lag creation. Blank means the SDKs are not reporting task lifecycle events yet.',
 'protocol.card.capability-matrix':
  'Which capabilities each side declared at initialization, as a share of the sessions where an exchange was observed. Each dot is 2% of those sessions, client row above server row. A capability near zero is one you cannot build a feature on yet.',
 'protocol.card.sampling':
  'Sampling requests in the window, their p95 duration, the share rejected among requests that reported an outcome, and the models returned. Missing measurements stay blank rather than zero. A high rejection share means clients are refusing the work you delegate.',
 'protocol.card.elicitation':
  'Elicitation requests in the window with the share accepted, declined and cancelled. Percentages use only requests that reported an action, so they can be blank while a count exists. Declines concentrated in one prompt mean that prompt is the problem.',
 'protocol.card.tasks':
  'Task lifecycle in the window: created, completed, failed and cancelled. Created counts distinct session and task ids observed; the others count observed transitions, so totals need not balance. Failures without completions means tasks are being started and lost.',
 'protocol.card.progress':
  'Calls that ran a second or longer, and the share of them that reported progress. Both stay blank until a call in the window carries progress events; an explicit zero is a real measurement. Long calls without progress are the ones that look frozen to a user.',

 /* ---------------------------------------------------------------------- Live */
 'live.card.events-per-second':
  'Events arriving in each of the last 40 seconds, from the live stream rather than the analytics rollups. The headline is the most recent full second. It is a liveness check, not a usage metric — use Overview for volume.',
 'live.card.event-mix':
  'The last 200 streamed events grouped by type, so you can see what your server is mostly doing right now. It is a rolling buffer, not a window, and pausing freezes it. Nothing but session events means clients connect and never call.',
 'live.card.errors-in-window':
  'How many of the last 200 streamed events were errors or failed calls. Counted from the stream, so it will not match Reliability, which uses the selected window. A burst here is the earliest warning you get.',
 'live.card.stream':
  'Every event as it arrives, newest first, capped at the latest 200. Expand one for its full payload; pause to hold the view still while you read. Filters apply to the buffer, so a quiet filter does not mean a quiet server.',

 /* ------------------------------------------------------------------ Settings */
 'settings.card.alert-rules':
  'The five rules the collector evaluates every minute: volume against the preceding seven-day hourly average, p95 against the preceding 24 hours, error rate held above the threshold for 15 minutes, destructive calls from an unrecognised client, and error-budget burn. Only state changes are recorded, and a missing sample or a gap over 90 seconds resets a pending breach instead of firing. Thresholds that are too tight here are the usual cause of alert fatigue.',
 'settings.card.analytics-settings':
  'The assumptions behind every number elsewhere: the success target for each SLO class, the divisor that turns output size into estimated tokens, the digest recipient, and the class of each tool. Changing the divisor rescales the whole Cost screen; changing a target moves error budget and the Tools below-SLO count. The tool list appears only when a complete catalogue has been seen.',
};

/** The copy for one card or tile, or undefined when that id has no explanation. */
export function explain(id: string): string | undefined { return explanations[id]; }
