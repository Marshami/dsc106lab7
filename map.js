import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

mapboxgl.accessToken = 'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
});

map.on('load', async () => {
  // Fetch and load bike lane data
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
      'line-opacity': 0.4,
    },
  });

  // Fetch and load BlueBikes station data
  const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  const stations = stationData.data.stations;

  // Create SVG overlay for station markers
  const svg = d3.select('#map').select('svg');
  const circles = svg.selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8);

  // Helper function to convert latitude/longitude to pixel coordinates
  function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  }

  // Update positions of station markers based on map panning and zooming
  function updatePositions() {
    circles.attr('cx', d => getCoords(d).cx)
           .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Add the time filtering feature
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
  }

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);
    circles.data(filteredStations)
           .join('circle')
           .attr('r', d => radiusScale(d.totalTraffic));
  }

  // Compute traffic data for the stations based on filtered time
  function computeStationTraffic(stations, timeFilter) {
    // Assume the traffic data is already available or parsed
    return stations.map(station => {
      station.totalTraffic = Math.random() * 100; // Example: Replace with actual traffic data
      return station;
    });
  }
});