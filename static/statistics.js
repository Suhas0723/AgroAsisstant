function calculateYieldGrowth(start, end) {
    const totalStart = start.reduce((a, b) => a + b, 0);
    const totalEnd = end.reduce((a, b) => a + b, 0);

    if (totalStart === 0) {
      return 0.0;
    }

    return (((totalEnd - totalStart) / totalStart) * 100).toFixed(1);
  }

  const colorPalette = [
    "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF",
    "#FF9F40", "#8BC34A", "#00BCD4", "#E91E63", "#9C27B0"
  ];
  
  const lightPalette = [
    "#FF8CA1", // lighter of FF6384
    "#66BCF0", // lighter of 36A2EB
    "#FFE27F", // lighter of FFCE56
    "#80DDDD", // lighter of 4BC0C0
    "#B399FF", // lighter of 9966FF
    "#FFBB75", // lighter of FF9F40
    "#AEE27A", // lighter of 8BC34A
    "#4EE1F0", // lighter of 00BCD4
    "#F06292", // lighter of E91E63
    "#BA68C8"  // lighter of 9C27B0
  ];
  
  const darkPalette = [
    "#CC4F6A", // darker of FF6384
    "#2C82BE", // darker of 36A2EB
    "#CCA944", // darker of FFCE56
    "#3A9999", // darker of 4BC0C0
    "#7A52CC", // darker of 9966FF
    "#CC7F33", // darker of FF9F40
    "#6FA53A", // darker of 8BC34A
    "#0092A6", // darker of 00BCD4
    "#C2185B", // darker of E91E63
    "#7B1FA2"  // darker of 9C27B0
  ];

  // Modify the centerTextPlugin
  const centerTextPlugin = {
      id: 'centerText',
      beforeDraw(chart, args, options) {
          const { width } = chart;
          const { height } = chart;
          const ctx = chart.ctx;
          ctx.restore();

          const fontSize = options.fontSize || 16;
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fontWeight = 'bold';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#808080';

          ctx.fillText(options.text, width / 2, height / 2);
          ctx.save();
      }
  };
  //Chart.register(centerTextPlugin);

  // Store schedule data globally so we can reuse it
  let globalScheduleData;
  let globalPlots;
  let plantData = {
    name: "Default",
    idealIrrigationPerWeek: 0,
    idealFertilizerPerWeek: 0,
    idealNPKPerWeek: "0-0-0",
    idealYieldGrowth: 0
  };

  let irrigationDonut;
  let fertilizerDonut;

  function renderOverallStats(data) {
        const irrigation = data.irrigations;
        const fertilizer = data.fertilizers;
        const harvests = data.harvests;

    // Donut: Total Gallons
        const irrigationLabels = Object.keys(irrigation);
        const irrigationValues = irrigationLabels.map(plant => {
        const total = irrigation[plant].reduce((sum, e) => {
            const inches = parseFloat(e.inches || 0);
            const acres = parseFloat(globalPlots[plant]?.acres || 0);
            const gallons = inches * acres * 27154; // Convert inches to gallons
            return sum + gallons;
        }, 0);
        return total.toFixed(2);
        });
        const irrigationTotal = irrigationValues.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);

    if (!irrigationDonut) {
    irrigationDonut = new Chart(document.getElementById('irrigationDonut'), {
          type: 'doughnut',
          data: {
              labels: irrigationLabels,
              datasets: [{
              data: irrigationValues,
            backgroundColor: irrigationLabels.map(plant => colorBank[plant] || '#AAAAAA'),
            borderColor: 'transparent',
            borderWidth: 1
              }]
          },
          options: {
              plugins: {
              legend: { display: false },
              centerText: {
              text: `${(irrigationTotal/1000).toFixed(1)}k gal`,
                  fontSize: 18,
              }
              }
          },
          plugins: [centerTextPlugin]
          });
    } else {
      irrigationDonut.data.labels = irrigationLabels;
      irrigationDonut.data.datasets[0].data = irrigationValues;
      irrigationDonut.options.plugins.centerText.text = `${(irrigationTotal/1000).toFixed(1)}k gal`;
      irrigationDonut.update();
    }

    // Donut: Total Pounds
        const fertilizerLabels = Object.keys(fertilizer);
        const fertilizerValues = fertilizerLabels.map(plant => {
        const total = fertilizer[plant].reduce((sum, e) => {
            const pounds = parseFloat(e.fert || 0);
            const acres = parseFloat(globalPlots[plant]?.acres || 0);
            const totalPounds = pounds * acres; // Convert to total pounds
            return sum + totalPounds;
        }, 0);
        return total.toFixed(2);
        });
        const fertilizerTotal = fertilizerValues.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);

    if (!fertilizerDonut) {
    fertilizerDonut = new Chart(document.getElementById('fertilizerDonut'), {
          type: 'doughnut',
          data: {
              labels: fertilizerLabels,
              datasets: [{
              data: fertilizerValues,
            backgroundColor: fertilizerLabels.map(plant => colorBank[plant] || '#AAAAAA'),
            borderColor: 'transparent',
            borderWidth: 10
              }]
          },
          options: {
              plugins: {
              legend: { display: false },
              centerText: {
              text: `${(fertilizerTotal/1000).toFixed(1)}k lbs`,
                  fontSize: 18,
              }
              }
          },
          plugins: [centerTextPlugin]
          });
    } else {
      fertilizerDonut.data.labels = fertilizerLabels;
      fertilizerDonut.data.datasets[0].data = fertilizerValues;
      fertilizerDonut.options.plugins.centerText.text = `${(fertilizerTotal/1000).toFixed(1)}k lbs`;
      fertilizerDonut.update();
    }

    // Line graphs with converted values
    lineGraph(fertilizer, 'fert', 'Fertilizer over Time', 'Fertilizer (lbs)', 'fertilizerLine', true);
    lineGraph(irrigation, 'inches', 'Irrigation over Time', 'Water (gal)', 'irrigationLine', true);
    //lineGraph(harvests, 'yield', 'Harvest Yield Over Time', 'Yield (lbs)', 'harvestLine')

        // Line: Harvest Yield
        const harvestLabels = Object.keys(harvests);

        const latest = harvestLabels.map(p => parseFloat(harvests[p].slice(-1)[0].yield || 0));
        const previous = harvestLabels.map(p => parseFloat(harvests[p].slice(-2)[0]?.yield || 0));
        const growth = calculateYieldGrowth(previous, latest);
    
    // Update yield growth progress circle
    const yieldGrowthElement = document.getElementById('yield-growth');
    const yieldProgressElement = document.getElementById('yield-progress');
    const circle = yieldProgressElement.querySelector('circle');
    
    // Calculate the percentage (cap at 100% for progress bar)
    const percentage = Math.min(Math.abs(growth), 100);
    
    // Update the circle progress
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    // Update color based on positive/negative growth
    circle.style.stroke = growth >= 0 ? '#4caf50' : '#f44336';
    
    // Update the text
    const growthText = growth >= 0 ? `+${growth}%` : `${growth}%`;
    yieldGrowthElement.textContent = growthText;
    yieldGrowthElement.style.color = growth >= 0 ? '#4caf50' : '#f44336';
  }

  const colorBank = {};
  colorBank["Default"] = "#AAAAAA";

  const plantSelector = document.getElementById('plant-selector');

  // Add this function after the colorBank declaration
  function updateColorBankDisplay() {
      const colorIndicators = document.querySelector('.color-indicators');
      colorIndicators.innerHTML = ''; // Clear existing indicators

      // Get unique plant names (excluding Light/Dark variants)
      const plantNames = Object.keys(colorBank).filter(key => 
          !key.endsWith('Light') && !key.endsWith('Dark') && key !== 'Default'
      );

      // Create color indicators for each plant
      plantNames.forEach(plant => {
          const indicator = document.createElement('div');
          indicator.className = 'color-indicator';
          
          const dotGroup = document.createElement('div');
          dotGroup.className = 'color-dot-group';
          
          const mainDot = document.createElement('div');
          mainDot.className = 'color-dot';
          mainDot.style.backgroundColor = colorBank[plant];
          
          dotGroup.appendChild(mainDot);
          
          const label = document.createElement('span');
          label.className = 'color-label';
          label.textContent = plant;
          
          indicator.appendChild(dotGroup);
          indicator.appendChild(label);
          colorIndicators.appendChild(indicator);
      });
  }

  document.addEventListener('DOMContentLoaded', function () {    
    fetch('/api/get_statistics_data')
        .then(res => res.json())
        .then(data => {
            console.log(data);
            globalScheduleData = data.schedule;
            globalPlots = data.plots;
            
            // Initialize color bank and plant selector
            plantSelector.innerHTML = '<option value="" disabled selected>Select a Plant</option>';
            Object.keys(globalPlots).forEach((plot, index) => {
                const option = document.createElement('option');
                option.value = plot;
                option.textContent = plot;
                plantSelector.appendChild(option);
                colorBank[plot] = colorPalette[index % colorPalette.length];
                colorBank[plot + "Light"] = lightPalette[index % lightPalette.length];
                colorBank[plot + "Dark"] = darkPalette[index % darkPalette.length];
            });

            // Update the color bank display
            updateColorBankDisplay();

            // Initialize charts and render data
            initializeComparisonCharts();
            renderOverallStats(globalScheduleData);
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            // Add fallback or error handling here
        });

    // Add event listener for plant selector
    plantSelector.addEventListener('change', function() {
        const selectedPlant = this.value;
        if (selectedPlant) {
            plantData = globalPlots[selectedPlant];
            updatePlantCharts(globalScheduleData);
        }
    });

    // Add event listener for theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (irrigationDonut) irrigationDonut.update();
        if (fertilizerDonut) fertilizerDonut.update();
      });
  });

  
  let lineGraphs = {
    irrigationLine: null,
    fertilizerLine: null,
  };

  function lineGraph(data, varName, title, yAxisLabel, chartName, convertUnits = false) {
      const datasets = [];
  
      const allDates = new Set();
  
      // Collect all unique dates
      Object.values(data).forEach(plant => {
          Object.values(plant).forEach(event => {
              allDates.add(event.date);
          });
      });
  
      // Sort dates
      const sortedDates = Array.from(allDates).sort();
  
      let colorIndex = 0;
  
      for (const [plant, events] of Object.entries(data)) {
        const dateMap = {};
        events.forEach(event => {
          let value = parseFloat(event[varName]) || 0;
          if (convertUnits) {
              const acres = parseFloat(globalPlots[plant]?.acres || 0);
              if (varName === 'inches') {
                  value = value * acres * 27154; // Convert inches to gallons
              } else if (varName === 'fert') {
                  value = value * acres; // Convert to total pounds
              }
          }
          dateMap[event.date] = value;
        });
  
        const series = sortedDates.map(date => dateMap[date] || 0);
  
        datasets.push({
          label: plant,
          data: series,
          borderColor: colorBank[plant] || '#AAAAAA',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3
        });
  
        colorIndex++;
      }
  
      if (!lineGraphs[chartName]) {
      const ctx = document.getElementById(chartName).getContext('2d');
        lineGraphs[chartName] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: sortedDates,
          datasets: datasets
        },
        options: {
          responsive: true,
          plugins: {
              legend: {
                  display: false
              },
              tooltip: {
              mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(context) {
                        let value = context.raw;
                        if (convertUnits) {
                            if (varName === 'inches') {
                                value = (value/1000).toFixed(1) + 'k gal';
                            } else if (varName === 'fert') {
                                value = (value/1000).toFixed(1) + 'k lbs';
                            }
                        }
                        return `${context.dataset.label}: ${value}`;
                    }
                }
              },
              title: {
              display: true,
              text: title,
              }
          },
          interaction: {
              mode: 'nearest',
              axis: 'x',
              intersect: false
          },
          scales: {
              y: {
              beginAtZero: true,
              title: {
                  display: true,
                  text: yAxisLabel
              }
              },
              x: {
              title: {
                  display: true,
                  text: 'Date'
              }
              }
          }
          }
      });
    } else {
      lineGraphs[chartName].data.labels = sortedDates;
      lineGraphs[chartName].data.datasets = datasets;
      lineGraphs[chartName].update();
    }
  }

  // Initialize charts as global variables
  let irrigationComparisonChart;
  let fertilizerComparisonChart;
  let npkComparisonChart;
  let harvestGrowthChart;

  // Function to parse NPK string into array of numbers
  function parseNPK(npkString) {
      return npkString.split('-').map(num => parseInt(num));
  }

  // Function to initialize the comparison charts
  function initializeComparisonCharts() {
      // Irrigation Comparison Chart
      if (!irrigationComparisonChart) {
          const irrigationCtx = document.getElementById('irrigationComparison').getContext('2d');
          irrigationComparisonChart = new Chart(irrigationCtx, {
              type: 'bar',
              data: {
                  labels: ['Ideal', 'Average'],
                  datasets: [
                      {
                          label: plantData.plot_name || 'Default',
                          data: [0, 0],
                          backgroundColor: [
                              colorBank["Default" + "Light"] || '#CCCCCC',
                              colorBank["Default" + "Dark"] || '#999999'
                          ]
                      }
                  ]
              },
              options: {
                  responsive: true,
                  scales: {
                      y: {
                          beginAtZero: true,
                          title: {
                              display: true,
                              text: 'Water (in)'
                          }
                      }
                  },
                  plugins: {
                      legend: {
                          display: false
                      }
                  }
              }
          });
      }

      // Combined Fertilizer and NPK Chart
      if (!fertilizerComparisonChart) {
          const fertilizerCtx = document.getElementById('fertilizerComparison').getContext('2d');
          fertilizerComparisonChart = new Chart(fertilizerCtx, {
              type: 'bar',
              data: {
                  labels: ['Ideal', 'Actual'],
                  datasets: [
                      {
                          label: 'Nitrogen (N)',
                          data: [0, 0],
                          backgroundColor: colorBank["Default" + "Light"] || '#CCCCCC',
                          stack: 'Stack 0'
                      },
                      {
                          label: 'Phosphorus (P)',
                          data: [0, 0],
                          backgroundColor: colorBank["Default"] || '#AAAAAA',
                          stack: 'Stack 0'
                      },
                      {
                          label: 'Potassium (K)',
                          data: [0, 0],
                          backgroundColor: colorBank["Default" + "Dark"] || '#999999',
                          stack: 'Stack 0'
                      }
                  ]
              },
              options: {
                  responsive: true,
                  scales: {
                      x: {
                          stacked: true
                      },
                      y: {
                          stacked: true,
                          beginAtZero: true,
                          title: {
                              display: true,
                              text: 'Fertilizer (lbs)'
                          }
                      }
                  },
                  plugins: {
                      legend: {
                          display: true,
                          position: 'left',
                          labels: {
                              usePointStyle: true,
                              pointStyle: 'rect',
                              boxWidth: 15,
                              boxHeight: 15,
                              padding: 15
                          }
                      },
                      title: {
                          display: false,
                      }
                  }
              }
          });
      }

      // Harvest Growth Chart
      if (!harvestGrowthChart) {
          const harvestCtx = document.getElementById('harvestGrowth').getContext('2d');
          harvestGrowthChart = new Chart(harvestCtx, {
              type: 'line',
              data: {
                  labels: [],
                  datasets: [{
                      label: 'Harvest Yield',
                      data: [],
                      borderColor: colorBank["Default" + "Dark"] || '#999999',
                      backgroundColor: colorBank["Default" + "Light"] || '#CCCCCC',
                      fill: true,
                      tension: 0.4
                  }]
              },
              options: {
                  responsive: true,
                  scales: {
                      y: {
                          beginAtZero: true,
                          title: {
                              display: true,
                              text: 'Yield (lbs)'
                          }
                      },
                      x: {
                          title: {
                              display: true,
                              text: 'Date'
                          }
                      }
                  },
                  plugins: {
                      legend: {
                          display: false
                      }
                  }
              }
          });
      }
  }

  // Add these functions at the top level
  function calculateEfficiency(actual, ideal) {
      return Math.max(0, 100 - (Math.abs(actual - ideal) / ideal) * 100);
  }

  function calculateNPKEfficiency(actualNPK, idealNPKPerWeek) {
      const actual = parseNPK(actualNPK);
      const ideal = parseNPK(idealNPKPerWeek);
      
      // Calculate efficiency for each component
      const nEfficiency = calculateEfficiency(actual[0], ideal[0]);
      const pEfficiency = calculateEfficiency(actual[1], ideal[1]);
      const kEfficiency = calculateEfficiency(actual[2], ideal[2]);
      
      // Return average of N, P, K efficiencies
      return (nEfficiency + pEfficiency + kEfficiency) / 3;
  }

  function calculateGrowthRate(harvests) {
      if (!harvests || harvests.length < 2) return 0;
      
      // Sort harvests by date
      const sortedHarvests = [...harvests].sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Get first and last harvest yields
      const firstYield = parseFloat(sortedHarvests[0].yield);
      const lastYield = parseFloat(sortedHarvests[sortedHarvests.length - 1].yield);
      
      // Calculate percentage growth
      const growthRate = ((lastYield - firstYield) / firstYield) * 100;
      return growthRate;
  }

  let averageIrrigationInches;
  let averageFertilizerLbs;
  let averageNPK;

  // Function to update charts with plant-specific data
  function updatePlantCharts(scheduleData) {
      const plant = plantData.plot_name;
      const selectedRange = document.getElementById('time-range').value;

      let multiplier = 1;
      if (selectedRange === 'week') {
        multiplier = 1;
      } else if (selectedRange === 'month') {
        multiplier = 4;
      } else if (selectedRange === '3months') {
        multiplier = 12;
      } else if (selectedRange === 'year') {
        multiplier = 52;
      }
      
      // Calculate average irrigation from schedule
      averageIrrigationInches = 0;
      if (scheduleData.irrigations[plant]) {
          const totalIrrigation = scheduleData.irrigations[plant].reduce((sum, e) => sum + parseFloat(e.inches || 0), 0);
          averageIrrigationInches = totalIrrigation;
      }

      // Calculate average fertilizer and NPK from schedule
      averageFertilizerLbs = 0;
      averageNPK = '0-0-0';
      if (scheduleData.fertilizers[plant]) {
          const totalFertilizer = scheduleData.fertilizers[plant].reduce((sum, e) => sum + parseFloat(e.fert || 0), 0);
          averageFertilizerLbs = totalFertilizer;

          const npkEvents = scheduleData.fertilizers[plant].filter(e => e.npk);
          if (npkEvents.length > 0) {
              const npkValues = npkEvents.map(e => parseNPK(e.npk));
              const sumN = npkValues.reduce((sum, npk) => sum + npk[0], 0);
              const sumP = npkValues.reduce((sum, npk) => sum + npk[1], 0);
              const sumK = npkValues.reduce((sum, npk) => sum + npk[2], 0);
              const avgN = Math.round(sumN / npkValues.length);
              const avgP = Math.round(sumP / npkValues.length);
              const avgK = Math.round(sumK / npkValues.length);
              averageNPK = `${avgN}-${avgP}-${avgK}`;
          }
      }

      // Calculate efficiencies
      const irrigationEfficiency = calculateEfficiency(averageIrrigationInches, plantData.idealValues.idealIrrigationPerWeek * multiplier);
      const fertilizerAmountEfficiency = calculateEfficiency(averageFertilizerLbs, plantData.idealValues.idealFertilizerPerWeek * multiplier);
      console.log(averageNPK, plantData.idealValues.idealNPKPerWeek);
      const npkEfficiency = calculateNPKEfficiency(averageNPK, plantData.idealValues.idealNPKPerWeek);
      const fertilizerEfficiency = (fertilizerAmountEfficiency * 0.5) + (npkEfficiency * 0.5);

      // Update efficiency displays
      updateProgressCircle('irrigation-efficiency', 'irrigation-progress', irrigationEfficiency);
      updateProgressCircle('fertilizer-efficiency', 'fertilizer-progress', fertilizerEfficiency);

      // Update Irrigation Comparison
      irrigationComparisonChart.data.datasets[0].data = [plantData.idealValues.idealIrrigationPerWeek * multiplier, averageIrrigationInches];
      irrigationComparisonChart.data.datasets[0].backgroundColor = [colorBank[plantData.plot_name + "Light"], colorBank[plantData.plot_name + "Dark"]];
      irrigationComparisonChart.update();

      // Update Combined Fertilizer and NPK Comparison
      const idealNPKPerWeek = parseNPK(plantData.idealValues.idealNPKPerWeek);
      const actualNPK = parseNPK(averageNPK);
      
      // Calculate the portion of fertilizer for each nutrient
      const idealTotal = idealNPKPerWeek.reduce((a, b) => a + b, 0);
      const actualTotal = actualNPK.reduce((a, b) => a + b, 0);
      
      // Calculate pounds of each nutrient based on ratios
      const idealN = (idealNPKPerWeek[0] / idealTotal) * plantData.idealValues.idealFertilizerPerWeek * multiplier;
      const idealP = (idealNPKPerWeek[1] / idealTotal) * plantData.idealValues.idealFertilizerPerWeek * multiplier;
      const idealK = (idealNPKPerWeek[2] / idealTotal) * plantData.idealValues.idealFertilizerPerWeek * multiplier;
      
      const actualN = (actualNPK[0] / actualTotal) * averageFertilizerLbs;
      const actualP = (actualNPK[1] / actualTotal) * averageFertilizerLbs;
      const actualK = (actualNPK[2] / actualTotal) * averageFertilizerLbs;
      
      fertilizerComparisonChart.data.datasets[0].data = [idealN, actualN];    // N
      fertilizerComparisonChart.data.datasets[0].backgroundColor = [colorBank[plantData.plot_name + "Light"], colorBank[plantData.plot_name + "Light"]];
      fertilizerComparisonChart.data.datasets[1].data = [idealP, actualP];    // P
      fertilizerComparisonChart.data.datasets[1].backgroundColor = [colorBank[plantData.plot_name], colorBank[plantData.plot_name]];
      fertilizerComparisonChart.data.datasets[2].data = [idealK, actualK];    // K
      fertilizerComparisonChart.data.datasets[2].backgroundColor = [colorBank[plantData.plot_name + "Dark"], colorBank[plantData.plot_name + "Dark"]];
      
      fertilizerComparisonChart.update();

      // Update Harvest Growth Chart
      let harvestData = [];
      let growthRate = 0;
      
      if (scheduleData.harvests && scheduleData.harvests[plant]) {
          const harvests = scheduleData.harvests[plant];
          // Sort harvests by date
          harvestData = [...harvests].sort((a, b) => new Date(a.date) - new Date(b.date));
          
          // Calculate growth rate
          growthRate = calculateGrowthRate(harvests);
          
          // Update chart
          harvestGrowthChart.data.labels = harvestData.map(h => h.date);
          harvestGrowthChart.data.datasets[0].data = harvestData.map(h => parseFloat(h.yield));
          harvestGrowthChart.data.datasets[0].backgroundColor = [colorBank[plantData.plot_name + "Light"], colorBank[plantData.plot_name + "Light"]];
          harvestGrowthChart.data.datasets[0].borderColor = [colorBank[plantData.plot_name + "Dark"], colorBank[plantData.plot_name + "Dark"]];
          harvestGrowthChart.update();
          
          // Update growth rate display with progress circle
          updateProgressCircle('growth-rate', 'growth-progress', growthRate, true);
      } else {
          // Clear chart if no harvest data
          harvestGrowthChart.data.labels = [];
          harvestGrowthChart.data.datasets[0].data = [];
          harvestGrowthChart.update();
          
          // Clear growth rate display
          document.getElementById('growth-rate').textContent = '0.0%';
          document.getElementById('growth-rate').style.color = '#666';
          // Reset progress circle
          const circle = document.querySelector('#growth-progress circle');
          if (circle) {
              circle.style.strokeDasharray = '0';
              circle.style.strokeDashoffset = '0';
              circle.style.stroke = '#666';
          }
      }
  }

  // Add this helper function after the existing functions
  function updateProgressCircle(elementId, progressId, value, isGrowth = false) {
    const element = document.getElementById(elementId);
    const progressElement = document.getElementById(progressId);
    const circle = progressElement.querySelector('circle');
    
    // Calculate the percentage (cap at 100% for progress bar)
    const percentage = Math.min(Math.abs(value), 100);
    
    // Update the circle progress
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    // Set color based on value
    let color;
    if (isGrowth) {
        // For growth metrics, use green for positive, red for negative
        color = value >= 0 ? '#4caf50' : '#f44336';
    } else {
        // For efficiency metrics, use color gradient based on percentage
        if (percentage >= 80) color = '#4caf50';      // Green for excellent
        else if (percentage >= 60) color = '#8bc34a';  // Light green for good
        else if (percentage >= 40) color = '#ffc107';  // Yellow for average
        else if (percentage >= 20) color = '#ff9800';  // Orange for poor
        else color = '#f44336';                        // Red for very poor
    }
    
    circle.style.stroke = color;
    
    // Update the text
    const displayText = isGrowth ? (value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`) : `${value.toFixed(1)}%`;
    element.textContent = displayText;
    element.style.color = color;
}

function filterDataByTimeRange(data, timeRange) {
  const now = new Date();
  let cutoffDate;
  
  switch(timeRange) {
      case 'week':
          cutoffDate = new Date(now.setDate(now.getDate() - 7));
          break;
      case 'month':
          cutoffDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
      case '3months':
          cutoffDate = new Date(now.setMonth(now.getMonth() - 3));
          break;
      case 'year':
          cutoffDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
      default:
          cutoffDate = new Date(now.setMonth(now.getMonth() - 1)); // Default to last month
  }

  // Create a deep copy of the data structure
  const filteredData = {
      irrigations: {},
      fertilizers: {},
      harvests: {}
  };

  // Filter irrigations
  Object.keys(data.irrigations || {}).forEach(plant => {
      const filtered = data.irrigations[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.irrigations[plant] = filtered;
      }
  });

  // Filter fertilizers
  Object.keys(data.fertilizers || {}).forEach(plant => {
      const filtered = data.fertilizers[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.fertilizers[plant] = filtered;
      }
  });

  // Filter harvests
  Object.keys(data.harvests || {}).forEach(plant => {
      const filtered = data.harvests[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.harvests[plant] = filtered;
      }
  });

  return filteredData;
}

document.getElementById('time-range').addEventListener('change', function() {
    const selectedRange = this.value;
    const filteredData = filterDataByTimeRange(globalScheduleData, selectedRange);
    
    renderOverallStats(filteredData);
    updatePlantCharts(filteredData);
  });