# Países del Mundo Quiz

Página para estudiar los **195 países del mundo** (193 de la ONU + Vaticano y Palestina) en el mapa.

**Jugá acá:** https://chiffoneg.github.io/paises-del-mundo-quiz/

## Qué tiene

- **Regiones:** todo el mundo o uno o varios continentes a la vez (África, Norte y Centroamérica, Sudamérica, Asia, Europa, Oceanía).
- **Modo Ubicar:** te muestra el nombre y la bandera de un país y lo tenés que marcar en el mapa. 3 intentos por país; si fallás, te lo marca en rojo.
- **Modo De memoria:** escribís todos los países que te acuerdes y se van pintando en el mapa. Botón "Ver lista" con los que ya pusiste en verde.
- **Modo Explorar:** tocás cualquier país y te muestra nombre, bandera y capital.
- **Banderas – De a una:** te muestra una bandera y escribís de qué país es (3 intentos, con "No sé" y "Saltar"). Al responder te muestra un mapita con el país.
- **Banderas – Todas juntas:** ves todas las banderas de la región y escribís el país en el casillero de abajo de cada una (intentos ilimitados; si le errás, se pone en rojo).
- **Pista (banderas):** el botón Pista muestra en un mapita dónde queda el país, sin decir el nombre. En Todas juntas tocás Pista y después la bandera. Al final te dice cuántas usaste.
- **Contador** de correctas (ej: 3/12) y **timer** personalizado para hacerlo tipo prueba, con pausa y botón de reiniciar.
- Zoom en el mapa y círculos para los países muy chicos.
- Modo claro / oscuro. Funciona en compu y celular.

## Cómo correrla localmente

Es una página estática: abrí `index.html` en el navegador (necesita internet para cargar las librerías y las banderas).

## Créditos

- Mapa: [Natural Earth](https://www.naturalearthdata.com/) vía [world-atlas](https://github.com/topojson/world-atlas) (dominio público).
- Banderas: [flagcdn.com](https://flagcdn.com).
- Librerías: [D3](https://d3js.org/) y [topojson-client](https://github.com/topojson/topojson-client).

## Al actualizar la página

Antes de cada commit corré `node scripts/version-assets.js`. Le agrega a `index.html` una huella (`?v=...`) a cada archivo CSS/JS, así los navegadores no usan versiones viejas guardadas en caché.
