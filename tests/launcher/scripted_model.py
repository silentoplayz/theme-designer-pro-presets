"""A scripted OpenAI-compatible model for the Launcher tests.

A user message 'THEME {json}' makes it call create_theme with those arguments;
'open the designer' makes it call open_theme_designer. Once the tool has
answered, it replies in text. Every request is kept for GET /log.
"""
import json, time, uuid
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
LOG = []


def chunk(model, delta, finish=None):
    return "data: " + json.dumps({"id": "chatcmpl-t", "object": "chat.completion.chunk", "created": int(time.time()), "model": model,
                                  "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\n"


def plan(messages, tools):
    last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
    if any(m.get("role") == "tool" for m in messages[last_user + 1:]):
        return None, "Here\u2019s Honu Lagoon: a turquoise palette with koi gliding under lily pads, and the panels turn to frosted glass so the pond shows through. Press Apply on the card to put it on."
    text = messages[last_user].get("content") if last_user >= 0 else ""
    if isinstance(text, list):
        text = " ".join(p.get("text", "") for p in text if isinstance(p, dict))
    names = [t["function"]["name"] for t in tools]
    if "open the designer" in text and "open_theme_designer" in names:
        return "open_theme_designer", {}
    if "koi pond lagoon" in text and "create_theme" in names:
        return "create_theme", {"name": "Honu Lagoon", "hue": 190, "chroma": 30, "lightness": 16, "description": "A turquoise lagoon where koi glide under frosted glass.", "background": "koi pond", "glass": True}
    if text.startswith("THEME ") and "create_theme" in names:
        return "create_theme", json.loads(text[6:])
    return None, "I can build a theme if you describe one."


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": "theme-bot", "object": "model", "owned_by": "tests", "name": "theme-bot"}]}


@app.get("/log")
async def log():
    return LOG


@app.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    model, messages, tools = body.get("model", "theme-bot"), body.get("messages", []), body.get("tools") or []
    name, payload = plan(messages, tools) if tools else (None, '{"title": "Theme test", "tags": [], "follow_ups": []}')
    LOG.append({"tools": [t["function"]["name"] for t in tools], "reply": {"tool": name, "args": payload} if name else {"text": payload},
                "tool_text": [m.get("content") for m in messages if m.get("role") == "tool"]})
    if not body.get("stream"):
        if name:
            msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_" + uuid.uuid4().hex[:12], "type": "function", "function": {"name": name, "arguments": json.dumps(payload)}}]}
            return JSONResponse({"id": "c", "object": "chat.completion", "model": model, "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls"}]})
        return JSONResponse({"id": "c", "object": "chat.completion", "model": model, "choices": [{"index": 0, "message": {"role": "assistant", "content": payload}, "finish_reason": "stop"}]})

    def events():
        yield chunk(model, {"role": "assistant", "content": ""})
        if name:
            yield chunk(model, {"tool_calls": [{"index": 0, "id": "call_" + uuid.uuid4().hex[:12], "type": "function", "function": {"name": name, "arguments": ""}}]})
            yield chunk(model, {"tool_calls": [{"index": 0, "function": {"arguments": json.dumps(payload)}}]})
            yield chunk(model, {}, "tool_calls")
        else:
            yield chunk(model, {"content": payload})
            yield chunk(model, {}, "stop")
        yield "data: [DONE]\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")
