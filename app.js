document.addEventListener('DOMContentLoaded', () => {
    let allStations = [];
    let activeFuelFilter = 'ALL';
    let activeStatusFilter = 'ALL';
    let searchQuery = '';
    let currentSource = 'combined';
    let currentCity = 'kazan';

    const container = document.getElementById('stations-container');
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const btnRefresh = document.getElementById('btn-refresh');
    
    // Timestamp Elements
    const schedulerUpdateTimeEl = document.getElementById('scheduler-update-time');
    const manualUpdateTimeEl = document.getElementById('manual-update-time');
    const sourceSelect = document.getElementById('source-select');
    const citySelect = document.getElementById('city-select');
    
    // Synchronize select value with state
    citySelect.value = currentCity;
    
    // Stats Elements
    const statTotal = document.getElementById('stat-total-stations');
    const statAvail = document.getElementById('stat-avail-stations');
    const statUnavail = document.getElementById('stat-unavail-stations');
    const statNodata = document.getElementById('stat-nodata-stations');
    const statQueue = document.getElementById('stat-queue-stations');

    // Fuel chips
    const fuelChips = document.querySelectorAll('#filter-fuel-type .filter-chip');
    fuelChips.forEach(chip => {
        chip.addEventListener('click', () => {
            fuelChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFuelFilter = chip.getAttribute('data-value');
            filterAndRender();
        });
    });

    // Status chips
    const statusChips = document.querySelectorAll('#filter-status .filter-chip');
    statusChips.forEach(chip => {
        chip.addEventListener('click', () => {
            statusChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeStatusFilter = chip.getAttribute('data-value');
            filterAndRender();
        });
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        searchClear.style.display = searchQuery ? 'block' : 'none';
        filterAndRender();
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchClear.style.display = 'none';
        filterAndRender();
    });

    // Refresh button
    btnRefresh.addEventListener('click', async () => {
        btnRefresh.classList.add('loading');
        container.innerHTML = '<div class="loading-spinner">Запрос на обновление API (3-4 сек)...</div>';
        
        try {
            // Trigger PHP script to run update_fuel.py on the NAS
            const phpResponse = await fetch(`update.php?t=${Date.now()}`);
            if (!phpResponse.ok) {
                console.warn('PHP updater script returned an error status.');
            }
        } catch (err) {
            console.warn('Could not contact update.php backend script:', err);
        }
        
        // Load the updated (or existing) JSON data
        fetchData();
    });

    // Source selector
    sourceSelect.addEventListener('change', (e) => {
        currentSource = e.target.value;
        fetchData();
    });

    // City selector
    citySelect.addEventListener('change', (e) => {
        currentCity = e.target.value;
        const cityName = currentCity === 'spb' ? 'Санкт-Петербурга' : (currentCity === 'moscow' ? 'Москвы' : 'Казани');
        document.title = `Мониторинг АЗС ${cityName} | Топливо`;
        document.getElementById('footer-text').innerHTML = 'Мониторинг АЗС © 2026. Разработано на основе открытых данных 2ГИС и Т-Банк Топливо.';
        fetchData();
    });

    // Fetch data from local data files
    async function fetchData() {
        btnRefresh.classList.add('loading');
        container.innerHTML = '<div class="loading-spinner">Загрузка данных АЗС...</div>';
        
        try {
            // Fetch status.json for update source and timestamp
            let statusInfo = { last_scheduler_update: null, last_manual_update: null };
            try {
                const statusRes = await fetch(`status.json?t=${Date.now()}`);
                if (statusRes.ok) {
                    statusInfo = await statusRes.json();
                }
            } catch (statusErr) {
                console.warn('Could not load status.json:', statusErr);
            }

            const suffix = currentCity === 'spb' ? '_spb' : (currentCity === 'moscow' ? '_moscow' : '_kazan');
            if (currentSource === 'combined') {
                const [res2gis, resTbank] = await Promise.all([
                    fetch(`data_2gis${suffix}.json?t=${Date.now()}`),
                    fetch(`data_tbank${suffix}.json?t=${Date.now()}`)
                ]);
                const data2gis = res2gis.ok ? await res2gis.json() : [];
                const rawTbank = resTbank.ok ? await resTbank.json() : [];
                const dataTbank = normalizeTBankData(rawTbank);
                allStations = mergeDataSources(data2gis, dataTbank);
            } else {
                const prefix = currentSource === 'tbank' ? 'data_tbank' : 'data_2gis';
                const filename = `${prefix}${suffix}.json`;
                const response = await fetch(`${filename}?t=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Не удалось загрузить ${filename}`);
                }
                const rawData = await response.json();
                
                if (currentSource === 'tbank') {
                    allStations = normalizeTBankData(rawData);
                } else {
                    allStations = rawData;
                }
            }

            // Expire reports older than 3 hours (mark available as null)
            const now = new Date();
            const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
            allStations.forEach(s => {
                const fuels = s.fuel_statuses || [];
                fuels.forEach(f => {
                    if (f.last_report_at) {
                        const reportTime = new Date(f.last_report_at);
                        if (now - reportTime > THREE_HOURS_MS) {
                            f.available = null;
                        }
                    } else {
                        f.available = null;
                    }
                });
            });
            
            // Format times
            if (statusInfo.last_scheduler_update) {
                const schedDate = new Date(statusInfo.last_scheduler_update);
                schedulerUpdateTimeEl.innerText = `Авто-обновление: ${schedDate.toLocaleDateString('ru-RU')} в ${schedDate.toLocaleTimeString('ru-RU')}`;
            } else {
                schedulerUpdateTimeEl.innerText = 'Авто-обновление: нет данных';
            }

            if (statusInfo.last_manual_update) {
                const manualDate = new Date(statusInfo.last_manual_update);
                manualUpdateTimeEl.innerText = `Ручное обновление: ${manualDate.toLocaleDateString('ru-RU')} в ${manualDate.toLocaleTimeString('ru-RU')}`;
            } else {
                manualUpdateTimeEl.innerText = 'Ручное обновление: нет данных';
            }
            
            // Post-process: If a fuel has a price in the 'prices' array but availability is null/undefined, set available = true!
            allStations.forEach(s => {
                const prices = s.prices || [];
                const fuels = s.fuel_statuses || [];
                
                prices.forEach(p => {
                    let f = fuels.find(x => x.fuel_type === p.fuel_type);
                    if (!f) {
                        f = {
                            station_id: s.station?.id,
                            fuel_type: p.fuel_type,
                            available: true,
                            queue_level: 'NONE',
                            last_report_at: p.updated_at
                        };
                        fuels.push(f);
                    } else if (f.available === null || f.available === undefined) {
                        f.available = true;
                        if (!f.last_report_at) {
                            f.last_report_at = p.updated_at;
                        }
                    }
                });
                s.fuel_statuses = fuels;
            });

            calculateStats(allStations);
            filterAndRender();
        } catch (error) {
            console.error('Error fetching fuel data:', error);
            container.innerHTML = `
                <div class="loading-spinner" style="color: var(--red-bright); flex-direction: column;">
                    <span>⚠️ Ошибка загрузки данных</span>
                    <span style="font-size: 13px; color: var(--text-secondary);">Убедитесь, что запущен скрипт update_fuel.py</span>
                </div>
            `;
        } finally {
            btnRefresh.classList.remove('loading');
        }
    }

    // Helper to calculate distance in meters between two coordinates
    function getDistanceMeters(lat1, lng1, lat2, lng2) {
        if (!lat1 || !lng1 || !lat2 || !lng2) return 999999;
        const R = 6371e3; // meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Merge list1 (2gis) and list2 (tbank) by geographical proximity (within 150m)
    function mergeDataSources(list1, list2) {
        // Deep copy list1 (2gis) to start with
        const merged = JSON.parse(JSON.stringify(list1));

        list2.forEach(s2 => {
            const st2 = s2.station || {};
            
            // Find if there is a matching station in list1
            const match = merged.find(s1 => {
                const st1 = s1.station || {};
                const dist = getDistanceMeters(st1.lat, st1.lng, st2.lat, st2.lng);
                return dist < 150; // 150 meters threshold
            });

            if (match) {
                // Merge fuels
                const fuels1 = match.fuel_statuses || [];
                const fuels2 = s2.fuel_statuses || [];

                fuels2.forEach(f2 => {
                    const f1 = fuels1.find(x => x.fuel_type === f2.fuel_type);
                    if (f1) {
                        const time1 = f1.last_report_at ? new Date(f1.last_report_at) : new Date(0);
                        const time2 = f2.last_report_at ? new Date(f2.last_report_at) : new Date(0);
                        
                        // Prefer confirmed status or newer report
                        if (f2.available !== null && (f1.available === null || time2 > time1)) {
                            f1.available = f2.available;
                            f1.queue_level = f2.queue_level;
                            f1.last_report_at = f2.last_report_at;
                        }
                        if (f2.limit_liters && !f1.limit_liters) {
                            f1.limit_liters = f2.limit_liters;
                        }
                    } else {
                        fuels1.push(f2);
                    }
                });
            } else {
                merged.push(s2);
            }
        });

        return merged;
    }

    // Normalize T-Bank JSON structure to match 2GIS schema
    function normalizeTBankData(tbankStations) {
        return tbankStations.map(s => {
            const fuels = Object.entries(s.statusByFuelType || {}).map(([fType, status]) => {
                const mappedType = fType === '92' ? 'AI_92' : 
                                   (fType === '95' ? 'AI_95' : 
                                   (fType === '98' ? 'AI_98' : 
                                   (fType === '100' ? 'AI_100' : 
                                   (fType === 'diesel' ? 'DT' : fType))));
                
                // Map status
                let available = null;
                let queue_level = 'NONE';
                if (status === 'available') {
                    available = true;
                } else if (status === 'maybe_available') {
                    available = true;
                    queue_level = 'UP_TO_30_MIN'; // Guessing queue
                } else if (status === 'not_available') {
                    available = false;
                }

                return {
                    fuel_type: mappedType,
                    available: available,
                    queue_level: queue_level,
                    last_report_at: s.lastTransactionAt
                };
            });

            // Extract brand name from the station name (first word) and normalize casing
            let brand = s.name.split(/[\s,]+/)[0];
            const brandUpper = brand.toUpperCase();
            if (brandUpper === 'ТАИФ-НК' || brandUpper === 'ТАИФ') brand = 'Таиф-НК';
            else if (brandUpper === 'ТАТНЕФТЬ') brand = 'Татнефть';
            else if (brandUpper === 'ГАЗПРОМНЕФТЬ') brand = 'Газпромнефть';
            else if (brandUpper === 'TEBOIL') brand = 'Teboil';
            else if (brandUpper === 'IRBIS') brand = 'Irbis';
            else if (brandUpper === 'ЛУКОЙЛ') brand = 'Лукойл';

            return {
                station: {
                    name: s.name,
                    brand: brand,
                    address: s.addr,
                    lat: s.lat,
                    lng: s.lon
                },
                fuel_statuses: fuels
            };
        });
    }

    function calculateStats(stations) {
        statTotal.innerText = stations.length;
        
        let availCount = 0;
        let unavailCount = 0;
        let nodataCount = 0;
        let heavyQueueCount = 0;

        stations.forEach(s => {
            const fuels = s.fuel_statuses || [];
            
            // Check if any fuel is confirmed available
            const hasAvailable = fuels.some(f => f.available === true);
            // Check if any fuel is confirmed unavailable
            const hasUnavailable = fuels.some(f => f.available === false);
            // Check for long queues
            const hasHeavyQueue = fuels.some(f => f.queue_level === 'OVER_30_MIN' && f.available === true);

            if (hasAvailable) availCount++;
            else if (hasUnavailable) unavailCount++;
            else nodataCount++;

            if (hasHeavyQueue) heavyQueueCount++;
        });

        statAvail.innerText = availCount;
        statUnavail.innerText = unavailCount;
        statNodata.innerText = nodataCount;
        statQueue.innerText = heavyQueueCount;
    }

    function filterAndRender() {
        let filtered = allStations;

        // Apply Search
        if (searchQuery) {
            filtered = filtered.filter(s => {
                const name = (s.station?.name || '').toLowerCase();
                const brand = (s.station?.brand || '').toLowerCase();
                const address = (s.station?.address || '').toLowerCase();
                return name.includes(searchQuery) || brand.includes(searchQuery) || address.includes(searchQuery);
            });
        }

        // Apply combined Fuel and Status Filters
        filtered = filtered.filter(s => {
            const fuels = s.fuel_statuses || [];
            
            // 1. If a specific fuel is filtered
            if (activeFuelFilter !== 'ALL') {
                const targetFuel = fuels.find(f => f.fuel_type === activeFuelFilter);
                if (!targetFuel) return false;
                
                const status = targetFuel.available;
                if (activeStatusFilter === 'AVAILABLE') return status === true;
                if (activeStatusFilter === 'UNAVAILABLE') return status === false;
                if (activeStatusFilter === 'NODATA') return status === null || status === undefined;
                
                // If status filter is 'ALL', show stations where this fuel is available
                return status === true;
            }
            
            // 2. If no specific fuel is filtered (activeFuelFilter === 'ALL')
            else {
                const hasAvail = fuels.some(f => f.available === true);
                const hasUnavail = fuels.some(f => f.available === false);
                
                if (activeStatusFilter === 'AVAILABLE') return hasAvail;
                if (activeStatusFilter === 'UNAVAILABLE') return !hasAvail && hasUnavail;
                if (activeStatusFilter === 'NODATA') return !hasAvail && !hasUnavail;
                return true;
            }
        });

        // Sort by newest report timestamp (newest first)
        filtered.sort((a, b) => {
            const getNewestTime = (station) => {
                const fuels = station.fuel_statuses || [];
                const timestamps = fuels.map(f => f.last_report_at).filter(Boolean);
                if (timestamps.length === 0) return 0;
                return Math.max(...timestamps.map(ts => new Date(ts).getTime()));
            };
            return getNewestTime(b) - getNewestTime(a);
        });

        renderStations(filtered);
    }

    const FUEL_LABELS = {
        "AI_92": "АИ-92",
        "AI_95": "АИ-95",
        "AI_98": "АИ-98",
        "AI_100": "АИ-100",
        "DT": "Дизель (ДТ)",
        "GAS": "Газ"
    };

    const QUEUE_LABELS = {
        "NONE": "Без очереди",
        "UP_TO_30_MIN": "Очередь < 30м",
        "OVER_30_MIN": "Очередь > 30м"
    };

    function renderStations(stations) {
        if (stations.length === 0) {
            container.innerHTML = '<div class="loading-spinner">Нет АЗС, соответствующих фильтрам</div>';
            return;
        }

        container.innerHTML = '';
        stations.forEach(s => {
            const st = s.station || {};
            const fuels = s.fuel_statuses || [];
            
            const hasAvail = fuels.some(f => f.available === true);
            const hasUnavail = fuels.some(f => f.available === false);
            
            let statusClass = 'status-nodata';
            let statusText = 'Нет отчетов';
            let badgeClass = 'badge-gray';

            if (hasAvail) {
                statusClass = 'status-available';
                statusText = 'Есть топливо';
                badgeClass = 'badge-green';
            } else if (hasUnavail) {
                statusClass = 'status-unavailable';
                statusText = 'Нет топлива';
                badgeClass = 'badge-red';
            }

            const card = document.createElement('div');
            card.className = `station-card ${statusClass}`;
            
            // Generate list of fuels
            let fuelsHtml = '';
            if (fuels.length > 0) {
                // Reorder fuels so that the active filtered fuel is always at the top!
                let sortedFuels = [...fuels];
                if (activeFuelFilter !== 'ALL') {
                    sortedFuels.sort((a, b) => {
                        if (a.fuel_type === activeFuelFilter) return -1;
                        if (b.fuel_type === activeFuelFilter) return 1;
                        return 0;
                    });
                }

                sortedFuels.forEach(f => {
                    const label = FUEL_LABELS[f.fuel_type] || f.fuel_type;
                    const availClass = f.available === true ? 'fuel-avail-true' : (f.available === false ? 'fuel-avail-false' : 'fuel-avail-none');
                    
                    // Highlight the row if it matches the active filter
                    const isHighlightedClass = f.fuel_type === activeFuelFilter ? 'fuel-highlighted' : '';
                    
                    // Extract price if it exists
                    const priceItem = (s.prices || []).find(p => p.fuel_type === f.fuel_type);
                    const priceHtml = priceItem ? `<span class="fuel-price">${priceItem.price} ₽</span>` : '';
                    
                    let detailsHtml = '';
                    if (f.available === true) {
                        const queueText = QUEUE_LABELS[f.queue_level] || f.queue_level;
                        detailsHtml += `<span class="fuel-queue-text">${queueText}</span>`;
                        if (f.limit_liters && f.limit_liters > 0) {
                            detailsHtml += `<span class="fuel-limit-tag">Лимит ${f.limit_liters}л</span>`;
                        }
                    } else if (f.available === false) {
                        detailsHtml += `<span class="fuel-queue-text" style="color: var(--red-bright); background: rgba(239,68,68,0.1)">Отсутствует</span>`;
                    } else {
                        detailsHtml += `<span class="fuel-queue-text" style="color: var(--text-secondary)">Нет свежих отзывов</span>`;
                    }

                    fuelsHtml += `
                        <div class="fuel-status-row ${availClass} ${isHighlightedClass}">
                            <span class="fuel-type-label">${label}</span>
                            <div class="fuel-details">
                                ${priceHtml}
                                ${detailsHtml}
                                <span class="fuel-availability-dot"></span>
                            </div>
                        </div>
                    `;
                });
            } else {
                fuelsHtml = '<div style="color: var(--text-secondary); font-size: 13px;">Данные о типах топлива отсутствуют</div>';
            }

            // Date formatting
            let newestReport = 'нет данных';
            const timestamps = fuels.map(f => f.last_report_at).filter(Boolean);
            if (timestamps.length > 0) {
                const dates = timestamps.map(ts => new Date(ts));
                const maxDate = new Date(Math.max.apply(null, dates));
                newestReport = maxDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' ' + maxDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            }

            // Map link
            const mapLink = st.lat ? `https://2gis.ru/search/АЗС/geo/${st.lng}%2C${st.lat}` : '#';

            card.innerHTML = `
                <div class="station-status-strip"></div>
                <div class="station-header">
                    <div class="station-title-box">
                        <span class="station-brand">${st.brand || 'АЗС'}</span>
                        <span class="station-name">${st.name || 'Без названия'}</span>
                    </div>
                    <span class="station-badge ${badgeClass}">${statusText}</span>
                </div>
                
                <div class="station-address">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="flex-shrink:0; margin-top:2px;">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                    </svg>
                    <span>${st.address || 'Адрес не указан'}</span>
                </div>

                <div class="station-fuels-section">
                    ${fuelsHtml}
                </div>

                <div class="station-footer">
                    <span>Обновлено: ${newestReport}</span>
                    <a href="${mapLink}" target="_blank" class="station-link">
                        Карта ↗
                    </a>
                </div>
            `;
            
            container.appendChild(card);
        });
    }

    // Initial Fetch
    fetchData();
});
