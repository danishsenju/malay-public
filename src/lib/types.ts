export type Network = 'rapid-bus-kl' | 'rapid-rail-kl' | 'ktmb' | 'mybas-johor'

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
  network:        Network
  fromName:       string
  toName:         string
  depTime:        string          // "HH:MM" MYT
  arrTime:        string
  durationMin:    number
  numStops:       number
}

/** The walk between two consecutive legs (or from/to the first/last stop). */
export interface JourneyTransfer {
  fromName:    string
  toName:      string
  walkMin:     number
  sameStation: boolean   // true when it's just a platform change
}

/** A complete A→B option: 1–3 rides joined by walking transfers. */
export interface JourneyOption {
  legs:       JourneyLeg[]
  /** transfers[i] sits between legs[i] and legs[i+1]. */
  transfers:  JourneyTransfer[]
  /** Walk from the chosen origin stop to the first boarding stop, if any. */
  startWalk?: JourneyTransfer
  /** Walk from the last alighting stop to the destination stop, if any. */
  endWalk?: JourneyTransfer
  depTime:    string
  arrTime:    string
  totalMin:   number
}

export interface JourneyResponse {
  options: JourneyOption[]
  /** false only when a bus stop is paired with a different network - the one
   *  combination we don't plan yet. */
  supported:   boolean
  generatedAt: number
}
