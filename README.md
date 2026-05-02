# MortageMap — 向九襄走

A React + Vite + TypeScript app that turns your mortgage payoff progress into a journey from Seattle to Jiuxiang (九襄), Sichuan, China — visualized on Google Maps satellite view.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Get a Google Maps JavaScript API key:
   - Enable **Maps JavaScript API** in [Google Cloud Console](https://console.cloud.google.com/).
   - Enable **billing** for the project.
   - If the key is restricted, allow `http://localhost:5173/*` as an HTTP referrer.

3. Create a `.env.local` file in the project root (copy from `.env.example`):

   ```env
   VITE_GOOGLE_MAPS_API_KEY=your_real_key_here
   ```

4. Start the dev server:

   ```sh
   npm run dev
   ```

   Open http://localhost:5173

## Build

```sh
npm run build
npm run preview
```

## How it works

- The route Seattle → Vancouver → Yukon → Alaska → Bering Strait → Russia Far East → NE China → Sichuan → 九襄 is symbolic.
- `progress = (originalPrincipal - currentBalance) / originalPrincipal`
- The marker is placed at `progress * totalRouteKm` along the great-circle polyline.
- The "extra payment preview" shows how many km a one-time extra payment would advance you.
