import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, PikaChartCardConfig, HassEntity, EntityConfig, AxisConfig } from './types/home-assistant-types';
import { ChartManager } from './chart-manager';
import { ChartJSAdapter } from './adapters/chartjs-adapter';
import { D3Adapter } from './adapters/d3-adapter';
import { ChartSeries, ChartDataPoint, ChartOptions, ChartAxis } from './types/chart-types';

@customElement('pika-chart-card')
export class PikaChartCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: PikaChartCardConfig;
  
  private chartManager: ChartManager | null = null;
  private refreshInterval: number | null = null;
  private chartContainer: HTMLDivElement | null = null;

  static getStubConfig(): PikaChartCardConfig {
    return {
      type: 'custom:pika-chart-card',
      entities: [
        {
          entity: 'sensor.temperature',
          name: 'Temperature',
          color: '#ff6384'
        }
      ],
      hours_to_show: 24,
      chart_type: 'line',
      library: 'chartjs'
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        height: 100%;
      }

      ha-card {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .card-header {
        padding: 16px;
        font-size: 18px;
        font-weight: 500;
      }

      .card-content {
        flex: 1;
        padding: 0 16px 16px 16px;
        min-height: 0;
        position: relative;
      }

      .chart-container {
        width: 100%;
        height: 100%;
        min-height: 200px;
        position: relative;
      }

      .error {
        color: var(--error-color);
        padding: 16px;
      }
    `;
  }

  setConfig(config: PikaChartCardConfig): void {
    if (!config.entities || config.entities.length === 0) {
      throw new Error('Please define at least one entity');
    }

    this.config = {
      chart_type: 'line',
      library: 'chartjs',
      hours_to_show: 24,
      refresh_interval: 60,
      show_legend: true,
      show_tooltip: true,
      show_grid: true,
      animate: true,
      theme: 'auto',
      height: 300,
      ...config
    };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.startRefreshInterval();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopRefreshInterval();
    if (this.chartManager) {
      this.chartManager.destroy();
      this.chartManager = null;
    }
  }

  render() {
    if (!this.config || !this.hass) {
      return html``;
    }

    return html`
      <ha-card>
        ${this.config.title ? html`<div class="card-header">${this.config.title}</div>` : ''}
        <div class="card-content">
          <div class="chart-container" id="chart-container"></div>
        </div>
      </ha-card>
    `;
  }

  protected firstUpdated(changedProperties: PropertyValues): void {
    super.firstUpdated(changedProperties);
    this.initializeChart();
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);
    
    if (changedProperties.has('hass') && this.chartManager) {
      this.updateChart();
    }
  }

  private initializeChart(): void {
    console.log('Initializing chart...');
    this.chartContainer = this.shadowRoot?.getElementById('chart-container') as HTMLDivElement;
    if (!this.chartContainer) {
      console.error('Chart container not found!');
      return;
    }

    console.log('Chart container found, creating adapter...');
    const adapterFactory = this.getAdapterFactory();
    this.chartManager = new ChartManager(adapterFactory);

    const chartOptions = this.createChartOptions();
    console.log('Chart options:', chartOptions);
    
    this.chartManager.initialize(this.chartContainer, chartOptions);
    console.log('Chart manager initialized');
    
    this.updateChart();
  }

  private getAdapterFactory(): () => ChartJSAdapter | D3Adapter {
    if (this.config.library === 'd3') {
      return () => new D3Adapter();
    }
    return () => new ChartJSAdapter();
  }

  private createChartOptions(): ChartOptions {
    const axes: ChartAxis = {};
    
    // Configure x-axis from config
    if (this.config.xaxis) {
      axes.x = {
        show: this.config.xaxis.show,
        min: typeof this.config.xaxis.min === 'number' ? this.config.xaxis.min : undefined,
        max: typeof this.config.xaxis.max === 'number' ? this.config.xaxis.max : undefined
      };
    }
    
    // Configure y-axis from config
    if (this.config.yaxis && this.config.yaxis.length > 0) {
      // Map axis configurations by ID for easy lookup
      const axisMap = new Map<string, AxisConfig>();
      this.config.yaxis.forEach(axis => {
        if (axis.id) {
          axisMap.set(axis.id, axis);
        }
      });
      
      // Determine which axes are actually used by entities
      const usedAxisIds = new Set<string>();
      this.config.entities.forEach(entity => {
        if (entity.yaxis_id) {
          usedAxisIds.add(entity.yaxis_id);
        }
      });
      
      // Assign axes based on usage
      // First axis (primary y-axis)
      const primaryAxisId = usedAxisIds.has('0') ? '0' : 
                           (usedAxisIds.size > 0 ? Array.from(usedAxisIds)[0] : '0');
      const primaryYAxis = axisMap.get(primaryAxisId) || this.config.yaxis[0];
      
      if (primaryYAxis) {
        axes.y = {
          show: primaryYAxis.show,
          min: typeof primaryYAxis.min === 'number' ? primaryYAxis.min : undefined,
          max: typeof primaryYAxis.max === 'number' ? primaryYAxis.max : undefined
        };
      }
      
      // Second axis (secondary y-axis) if there are multiple axes used
      if (usedAxisIds.size > 1) {
        const secondaryAxisId = usedAxisIds.has('1') ? '1' : 
                               Array.from(usedAxisIds).find(id => id !== primaryAxisId);
        if (secondaryAxisId) {
          const secondaryYAxis = axisMap.get(secondaryAxisId);
          if (secondaryYAxis) {
            axes.y2 = {
              show: secondaryYAxis.show,
              min: typeof secondaryYAxis.min === 'number' ? secondaryYAxis.min : undefined,
              max: typeof secondaryYAxis.max === 'number' ? secondaryYAxis.max : undefined
            };
          }
        }
      }
    }
    
    return {
      type: this.config.chart_type || 'line',
      series: [],
      title: this.config.title,
      height: this.config.height,
      stacked: this.config.stacked,
      showLegend: this.config.show_legend,
      showTooltip: this.config.show_tooltip,
      showGrid: this.config.show_grid,
      animate: this.config.animate,
      theme: this.getTheme(),
      axes: Object.keys(axes).length > 0 ? axes : undefined
    };
  }

  private async updateChart(): Promise<void> {
    if (!this.chartManager || !this.hass) return;

    try {
      const series = await this.fetchEntityData();
      this.chartManager.update(series);
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }

  private createAxisIdMapping(): Map<string, string> {
    const mapping = new Map<string, string>();
    
    // Get all unique axis IDs used by entities
    const usedAxisIds = new Set<string>();
    this.config.entities.forEach(entity => {
      if (entity.yaxis_id) {
        usedAxisIds.add(entity.yaxis_id);
      }
    });
    
    // Map the first used axis ID to 'y' and the second to 'y2'
    const sortedIds = Array.from(usedAxisIds).sort();
    if (sortedIds.length > 0) {
      mapping.set(sortedIds[0], 'y');
    }
    if (sortedIds.length > 1) {
      mapping.set(sortedIds[1], 'y2');
    }
    
    // If more than 2 axes are used, log a warning
    if (sortedIds.length > 2) {
      console.warn('Chart.js only supports 2 y-axes. Additional axes will be mapped to primary axis.');
      for (let i = 2; i < sortedIds.length; i++) {
        mapping.set(sortedIds[i], 'y');
      }
    }
    
    return mapping;
  }

  private async fetchEntityData(): Promise<ChartSeries[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (this.config.hours_to_show || 24) * 60 * 60 * 1000);

    // Create a mapping of custom axis IDs to Chart.js axis IDs
    const axisIdMapping = this.createAxisIdMapping();

    const seriesPromises = this.config.entities.map(async (entityConfig) => {
      const entity = this.hass.states[entityConfig.entity];
      if (!entity) {
        console.warn(`Entity ${entityConfig.entity} not found`);
        return null;
      }

      let data: ChartDataPoint[];
      
      if (entityConfig.statistics) {
        data = await this.fetchStatistics(entityConfig, startTime, endTime);
      } else {
        const history = await this.fetchHistory(entityConfig.entity, startTime, endTime);
        data = this.processHistoryData(history, entityConfig);
      }

      // Map custom axis ID to Chart.js axis ID
      let yAxisId = 'y';
      if (entityConfig.yaxis_id && axisIdMapping.has(entityConfig.yaxis_id)) {
        yAxisId = axisIdMapping.get(entityConfig.yaxis_id)!;
      }

      return {
        name: entityConfig.name || entity.attributes.friendly_name || entityConfig.entity,
        data: data,
        color: entityConfig.color,
        type: entityConfig.type || this.config.chart_type,
        unit: entityConfig.unit || entity.attributes.unit_of_measurement,
        show: entityConfig.show?.in_chart !== false,
        yAxisId: yAxisId
      } as ChartSeries;
    });

    const series = await Promise.all(seriesPromises);
    return series.filter(s => s !== null) as ChartSeries[];
  }

  private async fetchHistory(entityId: string, startTime: Date, endTime: Date): Promise<any[]> {
    try {
      const history = await this.hass.callWS({
        type: 'history/history_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        entity_ids: [entityId],
        include_start_time_state: true,
        significant_changes_only: true,
        minimal_response: false
      }) as Record<string, any[]>;

      console.log(`History response for ${entityId}:`, history);
      return history[entityId] || [];
    } catch (error) {
      console.error(`Error fetching history for ${entityId}:`, error);
      return [];
    }
  }

  private async fetchStatistics(entityConfig: EntityConfig, startTime: Date, endTime: Date): Promise<ChartDataPoint[]> {
    try {
      const statistics = await this.hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        statistic_ids: [entityConfig.entity],
        period: entityConfig.statistics?.period || 'hour'
      }) as Record<string, any[]>;

      const entityStats = statistics[entityConfig.entity];
      if (!entityStats || entityStats.length === 0) {
        return [];
      }

      const statType = entityConfig.statistics?.stat_type || 'mean';
      
      return entityStats.map((stat: any) => {
        let value: number;
        
        switch (statType) {
          case 'min':
            value = stat.min;
            break;
          case 'max':
            value = stat.max;
            break;
          case 'mean':
            value = stat.mean;
            break;
          case 'sum':
            value = stat.sum;
            break;
          case 'state':
            value = stat.state;
            break;
          default:
            value = stat.mean || stat.state;
        }

        return {
          x: new Date(stat.start),
          y: value || 0
        };
      }).filter((point: ChartDataPoint) => !isNaN(point.y));
    } catch (error) {
      console.error(`Error fetching statistics for ${entityConfig.entity}:`, error);
      return [];
    }
  }

  private processHistoryData(history: any[], entityConfig: any): ChartDataPoint[] {
    console.log(`Processing history data for entity:`, entityConfig, `History length:`, history.length);
    const processed = history
      .filter(state => state.state !== 'unknown' && state.state !== 'unavailable')
      .map(state => {
        const value = entityConfig.attribute 
          ? state.attributes[entityConfig.attribute]
          : parseFloat(state.state);

        const point = {
          x: new Date(state.last_changed),
          y: isNaN(value) ? 0 : value
        };
        
        if (history.indexOf(state) < 3) { // Log first few points for debugging
          console.log(`State:`, state.state, `Parsed value:`, value, `Date:`, state.last_changed, `Point:`, point);
        }
        
        return point;
      })
      .filter(point => !isNaN(point.y));
    
    console.log(`Processed ${processed.length} data points`);
    return processed;
  }


  private getTheme(): 'light' | 'dark' {
    if (this.config.theme === 'auto') {
      return this.hass.selectedTheme?.startsWith('dark') ? 'dark' : 'light';
    }
    return this.config.theme || 'light';
  }

  private startRefreshInterval(): void {
    if (this.refreshInterval) return;
    
    const interval = (this.config.refresh_interval || 60) * 1000;
    this.refreshInterval = window.setInterval(() => {
      this.updateChart();
    }, interval);
  }

  private stopRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  getCardSize(): number {
    return Math.ceil((this.config.height || 300) / 50);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pika-chart-card': PikaChartCard;
  }
}