export type Verification = 'demo' | 'unverified' | 'verified';
export interface FloorImage { url: string; alt: string; caption: string; demonstration: boolean }
export interface RoomRoute { entranceId: string; steps: string[] }
export interface Room { id: string; code: string; name: string; route: RoomRoute; accessibleRoute: RoomRoute | null; hotspot: { x: number; y: number } | null }
export interface Floor { id: string; name: string; image: FloorImage | null; rooms: Room[] }
export interface Entrance { id: string; name: string; coordinates: [number, number]; accessible: boolean; notes: string; steps: string[] }
export interface Building { id: string; name: string; aliases: string[]; coordinates: [number, number]; status: Verification; verificationNote: string; entrances: Entrance[]; floors: Floor[] }
export interface WayfindingContent { title: string; intro: string; notice: string; helpText: string; travelUrl: string; buildings: Building[] }
export interface WayfindingDocument { revision: string; content: WayfindingContent }
export interface LookupInfo { mode: 'demo' | 'private_import' | 'unavailable'; sourceLabel: string; demoCredentials?: { studentId: string; checkInCode: string }[] }
export interface PublicWayfindingDocument extends WayfindingDocument { lookup: LookupInfo; contentWarning: string | null }
export interface Assignment { round: string; roomId: string }
export interface LookupResponse { source: LookupInfo; assignments: Assignment[] }
export interface SearchResult { building: Building; floor?: Floor; room?: Room }
