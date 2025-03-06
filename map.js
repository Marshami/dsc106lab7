///////////////////////////////////
// 1) Import ES Modules
///////////////////////////////////
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

///////////////////////////////////
// 2) Initialize Mapbox
///////////////////////////////////
//  !!! REPLACE WITH YOUR REAL TOKEN FROM account.mapbox.com !!!
mapboxgl.accessToken = 'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston
  zoom: 12
});

// We'll add data & layers after map loads
map.on('load', onMapLoad);

///////////////////////////////////
// 3) Data & Visualization Setup
///////////////////////////////////
async function onMapLoad() {
  // A) Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // B) Load Station Data
  //    We'll place them as SVG circles on top
  const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = stationData.data.stations;

  // Create an <svg> selection on #map
  const svg = d3.select('#map').select('svg');

  // Append circles for each station
  const circles = svg.selectAll('circle')
    .data(stations, d => d.short_name) // key by short_name
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.8);

  // Helper: Convert station lon/lat to map pixel coords
  function projectCoords(station) {
    const point = new mapboxgl.LngLat(+station.Long, +station.Lat);
    const pixel = map.project(point);
    return [pixel.x, pixel.y];
  }

  // Keep circles in sync with map panning/zoom
  function updatePositions() {
    circles.attr('cx', d => projectCoords(d)[0])
           .attr('cy', d => projectCoords(d)[1]);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  ///////////////////////////////////
  // 4) Interactive Time Filter
  ///////////////////////////////////
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  timeSlider.addEventListener('input', onSliderChange);
  onSliderChange(); // initialize display

  function onSliderChange() {
    const val = +timeSlider.value;
    if (val === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'inline';
    } else {
      selectedTime.textContent = formatTime(val);
      anyTimeLabel.style.display = 'none';
    }
    // We could re-filter data or re-scale station circles based on time, etc.
    // (For demonstration, let's just console.log for now.)
    console.log('Time filter changed:', val);
  }

  // Helper to convert minutes-since-midnight to HH:MM AM/PM
  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // dummy date
    return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  }
}