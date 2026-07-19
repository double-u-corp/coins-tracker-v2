import type { NextPage } from "next";
import Head from "next/head";
import CalendarView from "@/features/calendar/CalendarView";

const CalendarPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Calendar</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Calendar</h1>
      <CalendarView />
    </>
  );
};

export default CalendarPage;
