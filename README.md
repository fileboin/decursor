# Decursor

Mobilni/browser-based code editor (Monaco) sa AI pomoći preko OpenRouter-a (mnogo besplatnih i plaćenih modela) i tvoje self-hosted Ollama instance. Push/pull fajlova direktno iz GitHub repoa.

## Struktura

```
decursor/
├── server.js          # Express backend - proksira pozive ka OpenRouter/Ollama, čuva API ključ
├── package.json
├── .env.example
└── public/
    ├── index.html      # Layout: Monaco editor + chat panel + GitHub modal
    └── app.js           # Sva frontend logika
```

## Pokretanje lokalno

```bash
cp .env.example .env
# upiši svoj OPENROUTER_API_KEY u .env

npm install
npm start
```

Otvori `http://localhost:3000`.

## Deploy na Render

1. Push ovaj folder u GitHub repo (npr. `fileboin/decursor`)
2. Na Render: New > Web Service > poveži repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Environment varijable (Render dashboard > Environment):
   - `OPENROUTER_API_KEY` = tvoj OpenRouter ključ
   - `OLLAMA_URL` (opciono) = npr. `https://ollama.tvojadomena.com` ako želiš default
   - `PUBLIC_URL` = URL koji ti Render dodijeli, npr. `https://decursor.onrender.com`

Free tier na Renderu se gasi poslije neaktivnosti — prvi zahtjev poslije pauze traje ~30s.

## Kako radi

### Chat / AI pomoć
- Biraš provider (OpenRouter ili Ollama) i model iz dropdown-a
- Checkbox "Pošalji kod kao kontekst" — kad je uključen, cijeli sadržaj editora se šalje uz pitanje
- Lista modela je u `app.js` (`OPENROUTER_MODELS` i `OLLAMA_MODELS`) — slobodno dodaj/ukloni modele

### Ollama
- Ako koristiš Ollama, URL tvog VPS-a se čuva u browseru (localStorage key: `decursor_ollama_url`).
  Za sada se postavlja ručno preko browser konzole dok ne dodamo poseban input u UI:
  ```js
  localStorage.setItem('decursor_ollama_url', 'https://ollama.tvojadomena.com')
  ```
- Ollama mora imati CORS dozvoljen za domenu na kojoj je Decursor hostovan (`OLLAMA_ORIGINS` env varijabla)
- Preporučeno: Caddy reverse proxy + Basic Auth ispred Ollama-e (vidi tvoju listu pending zadataka)

### GitHub integracija
- Klikni "GitHub" dugme gore desno
- Unesi Personal Access Token (sa `repo` scope-om), repo u formatu `owner/repo`, granu i putanju fajla
- "Pull" učitava fajl iz repoa u editor, "Push" snima trenutni sadržaj editora nazad u repo
- Token se čuva samo lokalno u tvom browseru (localStorage), nikad se ne šalje na Decursor backend

## TODO / sledeći koraci
- [ ] UI input za Ollama URL (umjesto ručnog localStorage seta)
- [ ] Multi-file podrška (trenutno je samo jedan editor prozor)
- [ ] Streaming odgovori (trenutno čeka cijeli odgovor)
- [ ] Caddy + Basic Auth ispred Ollama endpointa
