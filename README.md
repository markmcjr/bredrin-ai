# Bredrin

A proof-of-concept AI chat agent with a personality: a plain chat box and an animated robot face that reacts as the conversation goes.

- **Just the face and the chat.** No menus or frills. The only control is a small model picker in the input bar.
- **Expressive eyes.** There are 13 moods: happy, laugh, excited (star eyes), love (heart eyes), smug, wink, surprised, confused, thinking, sad, annoyed, sleepy and neutral. Bredrin also blinks, its eyes follow your cursor, it leans in while you type, and it dozes off if you ignore it. Poke it and it giggles; poke it too often and it gets grumpy.
- **The model drives the face.** Bredrin is told to put inline `[[mood]]` tags in its replies. The server removes them from the stream and sends them to the browser as separate events, so the expression changes in the middle of a sentence while the text streams in.
- **Pick your model.** Choose Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1 in the input bar. A **Demo** option works with no API key so you can try the face offline.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional — use the Demo model without it
npm start                             # http://localhost:3000
```

You can also pick a model from the URL with `?model=claude-haiku-5-5`. The browser remembers the last model you chose.

### Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Claude API key |
| `PORT` | `3000` | HTTP port |
| `MODELS` | Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1, Demo | Picker list, written as `id:Label,id:Label` |
| `DEFAULT_MODEL` | first entry in `MODELS` | Model to use when none is chosen |

## How it's built

```
server.js        Node HTTP server (no framework): serves /public and streams /api/chat as SSE
public/face.js   Face controller: mood → eye size, eyelid angles, mouth shape, gaze; blink loop
public/app.js    Chat UI, SSE reader and the local reactions (typing, poking, idle)
public/style.css Face rendering (CSS-only eyes and lids) and the chat layout
test/            Unit tests for the streaming [[mood]] tag parser (npm test)
```

- The personality lives in the `SYSTEM_PROMPT` in `server.js`. Edit it to change Bredrin's voice.
- To add a mood, add its name to `MOODS` in `server.js` and give it an entry in `MOODS`/`MOUTHS` in `public/face.js`.
- Replies use effort `low` to keep the chat snappy. Opus, Sonnet and Fable requests turn on the API's server-side refusal fallback.
