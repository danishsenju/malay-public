export type Network = 'rapid-bus-kl' | 'rapid-rail-kl' | 'ktmb'

/** Row returned by the nearby_stops() Supabase RPC, or from stop search. */
export interface NearbyStop {
  stop_id:    string
  stop_name:  string
  network:    Network
  stop_lat:   number
  stop_lon:   number
  distance_m?: number  // absent for search results
}

/** Row returned by the upcoming_arrivals() Supabase RPC. */
export interface Arrival {
  trip_id:          string
  route_id:         string | null
  route_short_name: string | null
  route_color:      string | null   // hex without '#'
  route_text_color: string | null   // hex without '#'
  trip_headsign:    string | null
  direction_id:     number | null
  scheduled_time:   string          // "HH:MM"
  minutes_until:    number
  arr_secs:         number          // raw seconds-since-midnight; unique per row, safe as React key
}

/** Shape of /api/vehicles/* JSON responses. */
export interface VehicleFeedResponse {
  vehicles: unknown[]
  stale:    boolean
  message?: string
}

/** One ride on one vehicle, as returned by /api/journey. */
export interface JourneyLeg {
  routeShortName: string | null
  routeColor:     string | null   // hex without '#'
  routeTextColor: string | null
  headsign:       string | null
  depTime:        string          // "HH:MM" MYT
  arrTime:        string
  durationMin:    number
  numStops:       number
}

/** A complete A→B option: one leg (direct) or two (one transfer). */
export interface JourneyOption {
  legs:          JourneyLeg[]
  transferStop?: string   // stop name, present when legs.length === 2
  depTime:       string
  arrTime:       string
  totalMin:      number
}

export interface JourneyResponse {
  options:     JourneyOption[]
  sameNetwork: boolean
  generatedAt: number
}
