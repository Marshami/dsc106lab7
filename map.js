////////////////////////////////////////////////////////////////////////////////
// 1) Mapbox Setup
////////////////////////////////////////////////////////////////////////////////
mapboxgl.accessToken =
  'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// We'll render station circles in an <svg> overlay
const svg = d3.select('#map').select('svg');

////////////////////////////////////////////////////////////////////////////////
// 2) Variables for Data + Time Slider
////////////////////////////////////////////////////////////////////////////////
let stations = [];
let trips = [];
let timeFilter = -1;

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

// We'll define a function so the slider can trigger data updates
let updateScatterPlotFn = null;

////////////////////////////////////////////////////////////////////////////////
// 3) Helper Functions
////////////////////////////////////////////////////////////////////////////////
function formatTime(minutes) {
  const dt = new Date(0, 0, 0, 0, minutes);
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function filterTripsByTime(tripData, t) {
  if (t === -1) return tripData;
  return tripData.filter(trip => {
    const startedM = minutesSinceMidnight(trip.started_at);
    const endedM   = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(startedM - t) <= 60 ||
      Math.abs(endedM - t)   <= 60
    );
  });
}

function computeStationTraffic(stationsArr, tripData) {
  // Tally departures
  const depMap = d3.rollup(
    tripData,
    v => v.length,
    d => d.start_station_id
  );
  // Tally arrivals
  const arrMap = d3.rollup(
    tripData,
    v => v.length,
    d => d.end_station_id
  );

  // Attach arrivals, departures, totalTraffic
  return stationsArr.map(st => {
    const sid = st.short_name;
    const dep = depMap.get(sid) || 0;
    const arr = arrMap.get(sid) || 0;
    return {
      ...st,
      departures: dep,
      arrivals: arr,
      totalTraffic: dep + arr
    };
  });
}

// Convert station's lon/lat => pixel coords for map's current view
function projectCoords(station) {
  // DSC106 data often uses lat/lon or Lat/Long. If your data uses lat/lon, do station.lat, station.lon
  const lngLat = new mapboxgl.LngLat(+station.lon, +station.lat);
  const pt = map.project(lngLat);
  return { cx: pt.x, cy: pt.y };
}

////////////////////////////////////////////////////////////////////////////////
// 4) Discrete Color Scale for ratio of departures => totalTraffic
////////////////////////////////////////////////////////////////////////////////
const colorScale = d3.scaleQuantize()
  .domain([0, 1])
  .range(['orange', 'purple', 'steelblue']);
// => orange = more arrivals, purple = balanced, steelblue = more departures
// (You can reorder the array if you prefer.)

////////////////////////////////////////////////////////////////////////////////
// 5) Time Slider handler
////////////////////////////////////////////////////////////////////////////////
function updateTimeDisplay() {
  timeFilter = +timeSlider.value;
  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  // If we've defined an update function, call it
  if (updateScatterPlotFn) {
    updateScatterPlotFn(timeFilter);
  }
}
timeSlider.addEventListener('input', updateTimeDisplay);

////////////////////////////////////////////////////////////////////////////////
// 6) Add Boston & Cambridge Bike Lanes
////////////////////////////////////////////////////////////////////////////////
map.on('style.load', () => {
  // Boston lanes
  map.addSource('boston_routes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'boston-lanes',
    type: 'line',
    source: 'boston_routes',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Cambridge lanes
  map.addSource('cambridge_routes', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/api/geospatial/gb5w-yva3?method=export&format=GeoJSON'
  });
  map.addLayer({
    id: 'cambridge-lanes',
    type: 'line',
    source: 'cambridge_routes',
    paint: {
      'line-color': 'blue',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  console.log('Boston + Cambridge lanes added.');
});

////////////////////////////////////////////////////////////////////////////////
// 7) Map load => fetch station/trip data, draw circles
////////////////////////////////////////////////////////////////////////////////
map.on('load', () => {
  const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const tripUrl    = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  d3.json(stationUrl)
    .then(stationJSON => {
      // Then load trips
      return d3.csv(tripUrl).then(loadedTrips => {
        trips = loadedTrips.map(tr => ({
          ...tr,
          started_at: new Date(tr.started_at),
          ended_at: new Date(tr.ended_at)
        }));
        console.log('Trips loaded:', trips.slice(0, 5));

        stations = computeStationTraffic(stationJSON.data.stations, trips);
        console.log('Stations computed:', stations.slice(0, 5));

        // Sizing scale
        const radiusScale = d3.scaleSqrt()
          .domain([0, d3.max(stations, d => d.totalTraffic) || 1])
          .range([2, 25]);

        // Draw circles
        const circles = svg.selectAll('circle')
          .data(stations, d => d.short_name)
          .enter()
          .append('circle')
          .attr('r', d => radiusScale(d.totalTraffic))
          .attr('fill', d => {
            if (!d.totalTraffic) return 'gray';
            const ratio = d.departures / d.totalTraffic;
            return colorScale(ratio);
          })
          .attr('opacity', 0.8)
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .each(function(d) {
            // Tooltip
            d3.select(this)
              .append('title')
              .text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
          });

        // Reposition circles on map pan/zoom
        function updatePositions() {
          circles
            .attr('cx', d => projectCoords(d).cx)
            .attr('cy', d => projectCoords(d).cy);
        }
        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // Define a function to refresh circles when slider changes
        function updateScatterPlot(chosenTime) {
          // Filter trips
          const filteredTrips = filterTripsByTime(trips, chosenTime);
          // Recompute station traffic
          const updatedStations = computeStationTraffic(stations, filteredTrips);

          // Adjust circle size range if user picks a narrower time
          if (chosenTime === -1) {
            radiusScale.range([2, 25]);
          } else {
            radiusScale.range([3, 50]);
          }

          const updated = svg.selectAll('circle')
            .data(updatedStations, d => d.short_name);

          updated
            .join('circle')
            .transition()
            .duration(500)
            .attr('r', d => radiusScale(d.totalTraffic))
            .attr('fill', d => {
              if (!d.totalTraffic) return 'gray';
              const ratio = d.departures / d.totalTraffic;
              return colorScale(ratio);
            });

          // Update tooltip text
          updated.each(function(d) {
            let title = d3.select(this).select('title');
            if (title.empty()) {
              title = d3.select(this).append('title');
            }
            title.text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
          });
        }

        // Let the slider call this function
        updateScatterPlotFn = updateScatterPlot;

        // Initial update
        updateScatterPlot(timeFilter);
      });
    })
    .catch(err => {
      console.error('Error loading station data or trips:', err);
    });
});