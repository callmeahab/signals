#!/usr/bin/env python3
"""Live MCP probe for both eggs. Prints one JSON object per line. No secrets."""
import asyncio
import json
import time

EXAMPLES = json.loads(r'[{"tool": "search_products", "input": {"query": "ramen", "limit": 20, "offset": 0}}, {"tool": "get_product", "input": {"product_id": "prd_mug"}}, {"tool": "create_order", "input": {"items": [{"product_id": "prd_mug", "quantity": 2}], "shipping_address": {"line1": "1 Market St", "city": "San Francisco", "postal_code": "94107", "country": "US"}, "idempotency_key": "demo-order-001"}}, {"tool": "search_flights", "input": {"origin": "SFO", "destination": "JFK", "departure_date": "2027-06-15"}}, {"tool": "get_seat_map", "input": {"flight_id": "flt_sfo_jfk"}}, {"tool": "book_ticket", "input": {"flight_id": "flt_sfo_jfk", "seat_id": "seat_10a", "passenger_name": "Demo User", "idempotency_key": "demo-flight-001"}}, {"tool": "search_hotels", "input": {"city": "San Francisco", "check_in": "2027-06-15", "check_out": "2027-06-17", "guests": 2}}, {"tool": "get_room_options", "input": {"hotel_id": "htl_bay", "check_in": "2027-06-15", "check_out": "2027-06-17", "guests": 2}}, {"tool": "reserve_room", "input": {"hotel_id": "htl_bay", "room_id": "room_queen", "check_in": "2027-06-15", "check_out": "2027-06-17", "guests": 2, "quantity": 1, "guest_name": "Demo User", "idempotency_key": "demo-room-001"}}, {"tool": "get_menu", "input": {"restaurant_id": "rst_ramen"}}, {"tool": "get_delivery_quote", "input": {"restaurant_id": "rst_ramen", "items": [{"menu_item_id": "menu_shoyu", "quantity": 2}], "delivery_address": {"line1": "1 Market St", "city": "San Francisco", "postal_code": "94107", "country": "US"}, "idempotency_key": "demo-quote-001"}}, {"tool": "place_food_order", "input": {"quote_id": "quote_demo", "idempotency_key": "demo-food-001"}}, {"tool": "search_events", "input": {"city": "San Francisco"}}, {"tool": "get_ticket_options", "input": {"event_id": "evt_jazz"}}, {"tool": "reserve_tickets", "input": {"event_id": "evt_jazz", "ticket_option_id": "tier_general", "quantity": 2, "attendee_name": "Demo User", "idempotency_key": "demo-event-001"}}]')
RUN = time.strftime("%Y%m%d%H%M%S")
EGGS = [("egg-node", 8001), ("egg-python", 8000)]
INVALID = [
    ("get_product", {"product_id": "prd_missing_e2e"}, "invalid-unknown-id"),
    ("search_flights", {"origin": "SFO", "destination": "SFO", "departure_date": "2027-06-15"}, "invalid-same-airport"),
]


def summarize(result):
    content = getattr(result, "content", None) or []
    kinds = []
    text = ""
    for block in content:
        kind = getattr(block, "type", None) or type(block).__name__
        kinds.append(kind)
        if kind == "text" and not text:
            text = (getattr(block, "text", "") or "")[:240]
    structured = getattr(result, "structured_content", None)
    ok = error = None
    if isinstance(structured, dict):
        ok = structured.get("ok")
        err = structured.get("error")
        if isinstance(err, dict):
            error = {k: err.get(k) for k in ("code", "message") if k in err}
        elif err is not None:
            error = str(err)[:180]
    return {
        "is_error": bool(getattr(result, "is_error", False)),
        "ok": ok,
        "error": error,
        "kinds": kinds,
        "text": text,
    }


def quote_id_from(result):
    structured = getattr(result, "structured_content", None)
    if not isinstance(structured, dict):
        text = ""
        for block in getattr(result, "content", None) or []:
            if getattr(block, "type", None) == "text":
                text = getattr(block, "text", "") or ""
                break
        try:
            structured = json.loads(text)
        except Exception:
            return None
    data = structured.get("data") if isinstance(structured, dict) else None
    quote = data.get("quote") if isinstance(data, dict) else None
    if isinstance(quote, dict) and isinstance(quote.get("id"), str):
        return quote["id"]
    return None


def with_key(tool, payload, egg):
    args = json.loads(json.dumps(payload))
    if "idempotency_key" in args:
        args["idempotency_key"] = "e2e-%s-%s-%s" % (egg, tool, RUN)
    return args


async def call(client, tool, arguments, tag):
    row = {"tag": tag, "tool": tool}
    try:
        result = await client.call_tool(tool, arguments)
        row.update(summarize(result))
        row["raised"] = None
        row["_result"] = result
    except Exception as exc:
        row.update({"raised": "%s: %s" % (type(exc).__name__, exc), "is_error": None, "ok": None, "error": None, "kinds": [], "text": ""})
        row["_result"] = None
    printable = {k: v for k, v in row.items() if k != "_result"}
    print(json.dumps(printable, default=str), flush=True)
    return row


async def probe_egg(name, port):
    from mcp.client import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import Implementation

    print(json.dumps({"egg": name, "phase": "start", "run": RUN, "port": port}), flush=True)
    async with streamable_http_client("http://10.8.0.11:%d/mcp" % port) as streams:
        async with ClientSession(
            streams[0],
            streams[1],
            client_info=Implementation(name="e2e-rtxbox", version="tools-%s" % RUN),
        ) as client:
                init = await client.initialize()
                info = init.server_info.model_dump() if hasattr(init.server_info, "model_dump") else {}
                caps = init.capabilities.model_dump() if hasattr(init.capabilities, "model_dump") else {}
                print(json.dumps({"egg": name, "phase": "initialize", "server": info, "capability_keys": sorted(caps)}), flush=True)
                listed = await client.list_tools()
                tool_names = [t.name for t in listed.tools]
                print(json.dumps({"egg": name, "phase": "tools", "count": len(tool_names), "names": tool_names}), flush=True)
                resources = []
                try:
                    found = await client.list_resources()
                    resources = [r.uri for r in found.resources]
                except Exception as exc:
                    resources = ["ERROR %s: %s" % (type(exc).__name__, exc)]
                print(json.dumps({"egg": name, "phase": "resources", "uris": [str(u) for u in resources]}, default=str), flush=True)
                quote_id = None
                for example in EXAMPLES:
                    tool = example["tool"]
                    if tool == "place_food_order":
                        continue
                    row = await call(client, tool, with_key(tool, example["input"], name), "valid")
                    if tool == "get_delivery_quote" and row.get("_result") is not None:
                        quote_id = quote_id_from(row["_result"])
                        print(json.dumps({"egg": name, "phase": "quote", "got_id": bool(quote_id)}), flush=True)
                food = next(e for e in EXAMPLES if e["tool"] == "place_food_order")
                food_args = with_key("place_food_order", food["input"], name)
                if quote_id:
                    food_args["quote_id"] = quote_id
                food_args["_substituted_quote"] = bool(quote_id)
                substituted = food_args.pop("_substituted_quote")
                await call(client, "place_food_order", food_args, "valid-quote-substituted" if substituted else "valid-example-quote")
                for tool, arguments, tag in INVALID:
                    await call(client, tool, arguments, tag)
                # Spec scenario primitives are not this server. Record the negative.
                echo = await call(client, "echo", {"message": "hello"}, "spec-echo-absent")
                try:
                    hello = await client.read_resource("demo://hello")
                    print(json.dumps({"egg": name, "phase": "spec-resource", "uri": "demo://hello", "unexpected": True, "n": len(getattr(hello, "contents", []) or [])}), flush=True)
                except Exception as exc:
                    print(json.dumps({"egg": name, "phase": "spec-resource", "uri": "demo://hello", "absent": "%s: %s" % (type(exc).__name__, str(exc)[:240])}), flush=True)
                shop = "ui://mcpramen/shop.html"
                try:
                    doc = await client.read_resource(shop)
                    contents = getattr(doc, "contents", None) or []
                    size = 0
                    mime = None
                    for block in contents:
                        blob = getattr(block, "text", None) or getattr(block, "blob", None) or ""
                        size += len(blob) if isinstance(blob, str) else 0
                        mime = getattr(block, "mimeType", None) or mime
                    print(json.dumps({"egg": name, "phase": "resource-read", "uri": shop, "parts": len(contents), "chars": size, "mime": mime}), flush=True)
                except Exception as exc:
                    print(json.dumps({"egg": name, "phase": "resource-read", "uri": shop, "error": "%s: %s" % (type(exc).__name__, str(exc)[:300])}), flush=True)
                print(json.dumps({"egg": name, "phase": "closing", "echo_is_error": echo.get("is_error"), "echo_raised": echo.get("raised")}), flush=True)
    # Session DELETE is sent by streamable_http_client on exit (terminate_on_close).
    # Burst of 50 in a fresh session so the tool census stays exact.
    async with streamable_http_client("http://10.8.0.11:%d/mcp" % port) as streams:
        async with ClientSession(
            streams[0],
            streams[1],
            client_info=Implementation(name="e2e-rtxbox", version="burst-%s" % RUN),
        ) as client:
                await client.initialize()
                started = time.monotonic()
                errors = 0
                for i in range(50):
                    row = await call(client, "search_products", {"query": "Mug", "limit": 1}, "burst")
                    if row.get("is_error") or row.get("raised") or row.get("ok") is False:
                        errors += 1
                elapsed = round(time.monotonic() - started, 3)
                print(json.dumps({"egg": name, "phase": "burst-done", "calls": 50, "client_errors": errors, "seconds": elapsed}), flush=True)


async def main():
    print(json.dumps({"phase": "run", "run": RUN}), flush=True)
    for name, port in EGGS:
        await probe_egg(name, port)
    print(json.dumps({"phase": "client-done", "run": RUN}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
