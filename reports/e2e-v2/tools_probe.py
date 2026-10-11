#!/usr/bin/env python3
"""Call every catalogue tool once, two invalid calls, one unknown tool, and a 50-call burst."""
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Implementation

_examples = json.loads(Path("/app/contracts/tool-examples.json").read_text())["examples"]
EXAMPLES = {item["tool"]: item for item in _examples} if isinstance(_examples, list) else _examples
ORDER = [
    "search_products",
    "get_product",
    "create_order",
    "search_flights",
    "get_seat_map",
    "book_ticket",
    "search_hotels",
    "get_room_options",
    "reserve_room",
    "get_menu",
    "get_delivery_quote",
    "place_food_order",
    "search_events",
    "get_ticket_options",
    "reserve_tickets",
]
STAMP = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def body(result):
    structured = getattr(result, "structured_content", None)
    if isinstance(structured, dict) and structured:
        return structured
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if not text:
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"text": text[:240]}
        if isinstance(parsed, dict):
            return parsed
    return {}


def summarize(result):
    payload = body(result)
    error = payload.get("error") if isinstance(payload, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    return {
        "is_error": bool(result.is_error),
        "ok": payload.get("ok") if isinstance(payload, dict) else None,
        "code": code,
    }


def arguments(tool):
    args = json.loads(json.dumps(EXAMPLES[tool]["input"]))
    if "idempotency_key" in args:
        args["idempotency_key"] = f"e2e-v2-{STAMP}-{tool}"
    return args


async def open_client(port, version):
    url = f"http://10.8.0.11:{port}/mcp"
    context = streamable_http_client(url)
    streams = await context.__aenter__()
    get_session_id = streams[2] if len(streams) > 2 else None
    client_context = ClientSession(
        streams[0],
        streams[1],
        client_info=Implementation(name="e2e-v2", version=version),
    )
    client = await client_context.__aenter__()
    init = await client.initialize()
    sid = get_session_id() if callable(get_session_id) else None
    return context, client_context, client, init, sid


async def close_client(context, client_context):
    await client_context.__aexit__(None, None, None)
    await context.__aexit__(None, None, None)


async def catalogue(port):
    version = f"tools-{STAMP}"
    context, client_context, client, init, sid = await open_client(port, version)
    report = {
        "port": port,
        "version": version,
        "session": sid,
        "server": {"name": init.server_info.name, "version": init.server_info.version},
        "calls": [],
        "sequence": [],
    }
    try:
        listed = await client.list_tools()
        names = [tool.name for tool in listed.tools]
        report["advertised"] = names
        print(stamp(), port, "advertised", len(names), flush=True)
        quote_id = None
        seat_id = None
        for tool in ORDER:
            args = arguments(tool)
            if tool == "book_ticket" and seat_id:
                args["seat_id"] = seat_id
                item_seat = seat_id
            else:
                item_seat = None
            if tool == "place_food_order" and quote_id:
                args["quote_id"] = quote_id
            started = time.monotonic()
            result = await client.call_tool(tool, args)
            item = {"tool": tool, "ms": round((time.monotonic() - started) * 1000, 1), **summarize(result)}
            if item_seat:
                item["seat_id"] = item_seat
            payload = body(result)
            if tool == "get_seat_map":
                seats = payload.get("data", {}).get("seats", []) if isinstance(payload, dict) else []
                free = [seat.get("id") for seat in seats if isinstance(seat, dict) and seat.get("available") and seat.get("id")]
                example_seat = EXAMPLES["book_ticket"]["input"].get("seat_id")
                seat_id = example_seat if example_seat in free else (free[0] if free else None)
                item["free_seats"] = free
                report["free_seats"] = free
            if tool == "get_delivery_quote" and isinstance(payload, dict):
                quote_id = payload.get("data", {}).get("quote", {}).get("id")
                item["quote_id"] = quote_id
            report["calls"].append(item)
            report["sequence"].append(tool)
            print(stamp(), port, "tool", json.dumps(item, sort_keys=True), flush=True)
        # A sold-out example seat is still a valid call. Retry once with a free seat
        # only when the seat map named one and the example seat was rejected.
        booked = next(item for item in report["calls"] if item["tool"] == "book_ticket")
        alternate = next((seat for seat in report.get("free_seats") or [] if seat != booked.get("seat_id")), None)
        if booked["is_error"] and booked.get("code") == "OUT_OF_STOCK" and alternate:
            args = arguments("book_ticket")
            args["seat_id"] = alternate
            args["idempotency_key"] = f"e2e-v2-{STAMP}-book_ticket-free"
            result = await client.call_tool("book_ticket", args)
            item = {"tool": "book_ticket", "retry": True, "seat_id": alternate, **summarize(result)}
            report["calls"].append(item)
            report["sequence"].append("book_ticket")
            print(stamp(), port, "tool", json.dumps(item, sort_keys=True), flush=True)
        invalids = [
            ("get_product", {"product_id": "e2e-v2-missing"}),
            ("search_flights", {"origin": "SFO", "destination": "SFO", "departure_date": "2027-06-15"}),
        ]
        for tool, args in invalids:
            try:
                result = await client.call_tool(tool, args)
                item = {"tool": tool, "invalid": True, **summarize(result)}
            except Exception as error:
                item = {"tool": tool, "invalid": True, "raised": type(error).__name__, "message": str(error)[:240]}
            report["calls"].append(item)
            print(stamp(), port, "invalid", json.dumps(item, sort_keys=True), flush=True)
        try:
            result = await client.call_tool("e2e_v2_unknown_tool", {})
            item = {"tool": "e2e_v2_unknown_tool", "unknown": True, **summarize(result)}
        except Exception as error:
            item = {
                "tool": "e2e_v2_unknown_tool",
                "unknown": True,
                "raised": type(error).__name__,
                "message": str(error)[:240],
            }
        report["calls"].append(item)
        print(stamp(), port, "unknown", json.dumps(item, sort_keys=True), flush=True)
    finally:
        await close_client(context, client_context)
        print(stamp(), port, "catalogue-session-closed", sid, flush=True)
    return report


async def burst(port):
    version = f"burst-{STAMP}"
    context, client_context, client, init, sid = await open_client(port, version)
    started = time.monotonic()
    errors = 0
    try:
        for i in range(50):
            result = await client.call_tool("search_products", {"query": "Mug", "limit": 1})
            if result.is_error:
                errors += 1
    finally:
        await close_client(context, client_context)
    elapsed = round(time.monotonic() - started, 3)
    print(stamp(), port, "burst", json.dumps({"version": version, "session": sid, "calls": 50, "errors": errors, "seconds": elapsed}), flush=True)
    return {"version": version, "session": sid, "calls": 50, "errors": errors, "seconds": elapsed}


async def one(port):
    print(stamp(), "begin", port, flush=True)
    catalogue_report = await catalogue(port)
    burst_report = await burst(port)
    print(stamp(), "end", port, flush=True)
    return {"catalogue": catalogue_report, "burst": burst_report}


async def main():
    print(stamp(), "stamp", STAMP, "order", ",".join(ORDER), flush=True)
    results = await asyncio.gather(one(8000), one(8001), return_exceptions=True)
    summary = {"stamp": STAMP, "order": ORDER, "eggs": {}}
    failed = False
    for port, result in zip((8000, 8001), results):
        if isinstance(result, BaseException):
            failed = True
            summary["eggs"][str(port)] = {"error": f"{type(result).__name__}: {result}"}
            print(stamp(), port, "FAIL", type(result).__name__, result, flush=True)
        else:
            summary["eggs"][str(port)] = result
    print("SUMMARY " + json.dumps(summary), flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
