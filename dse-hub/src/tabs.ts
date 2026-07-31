// The hub's tab configuration. Adding a new header tab (or a new subtab) = one entry here plus
// its component — the shell in App.tsx renders whatever is listed. First tab: Meetings.
import type { ComponentType } from "react";
import MeetingTracker from "./meetings/MeetingTracker";
import PiRoadmap from "./pi/PiRoadmap";

export interface SubTab {
  id: string;
  label: string;
  component: ComponentType;
}

export interface HeaderTab {
  id: string;
  label: string;
  icon?: string;
  subs: SubTab[];
}

export const TABS: HeaderTab[] = [
  {
    id: "meetings",
    label: "Meetings",
    icon: "📅",
    subs: [{ id: "tracker", label: "Meeting Tracker", component: MeetingTracker }],
  },
  {
    id: "sprints",
    label: "Sprints & PIs",
    icon: "🗓️",
    subs: [{ id: "roadmap", label: "PI Roadmap", component: PiRoadmap }],
  },
];
