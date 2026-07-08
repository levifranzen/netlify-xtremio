# Xtremio Netlify Addon

Versão simples em TypeScript/Netlify Functions baseada no `index.py` original.

## O que persiste no Redis

Somente dados pequenos:

- `tmdb:{lang}:{imdbId}`
- `match:{providerHash}:{movie|series}:{tmdbId}`
- `miss:{providerHash}:{movie|series}:{tmdbId}` com TTL curto

## O que NÃO vai para o Redis

O provider index **não** é salvo no Redis.
Ele fica somente em `/tmp/xtremio-cache` dentro da Function, como cache local, temporário e descartável.
Se a Function esfriar ou o `/tmp` sumir, o índice é baixado/montado novamente.

## Variáveis de ambiente

Veja `.env.example`.

## Rodando local

```bash
npm install
npm i -g netlify-cli
npm run dev
```

Abra:

```txt
http://localhost:8888/configure
```

## Deploy

Suba o projeto no Netlify e configure as variáveis de ambiente.
Depois acesse:

```txt
https://SEU-SITE.netlify.app/configure
```
