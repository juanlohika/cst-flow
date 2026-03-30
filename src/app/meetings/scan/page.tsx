"use client";

import React, { useEffect, useRef, useState } from "react";
import { QrCode, Camera, Check, AlertTriangle } from "lucide-react";
import jsQR from "jsqr";

interface MeetingInfo {
  meetingId: string;
  title: string;
  scheduledAt: string;
  status: string;
  attendeesCount: number;
}

export default function MeetingScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>("");
  const [foundCode, setFoundCode] = useState<string>("");
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [registrationState, setRegistrationState] = useState<string>("");

  const startScan = async () => {
    setError("");
    setMeeting(null);
    setFoundCode("");
    setRegistrationState("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanFrame();
    } catch (e) {
      console.error(e);
      setError("Camera access denied or unavailable.");
    }
  };

  const stopScan = () => {
    setScanning(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
  };

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code?.data) {
      setFoundCode(code.data);
      stopScan();
      handleMeetingLookup(code.data);
      return;
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  };

  const handleMeetingLookup = async (qrValue: string) => {
    try {
      const response = await fetch(`/api/meetings/lookup?qr=${encodeURIComponent(qrValue)}`);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Meeting not found");
      }
      const data: MeetingInfo = await response.json();
      setMeeting(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Meeting lookup failed.");
    }
  };

  const registerAttendee = async () => {
    if (!meeting?.meetingId) return;
    if (!attendeeName.trim() || !attendeeEmail.trim()) {
      setRegistrationState("Name and email are required.");
      return;
    }

    try {
      const res = await fetch(`/api/meetings/${meeting.meetingId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: attendeeName,
          email: attendeeEmail,
          companyName: "",
          position: "",
          consentGiven: true,
          registrationType: "qr-scan",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Registration failed");
      }

      setRegistrationState("Attendee registered successfully.");
      setAttendeeName("");
      setAttendeeEmail("");
    } catch (err: any) {
      console.error(err);
      setRegistrationState(err.message || "Registration failed.");
    }
  };

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Meeting QR Check-in</h1>
      <p className="text-sm text-text-secondary">
        Scan the attendee QR code and register them to the extracted meeting.
      </p>

      <div className="flex gap-2">
        <button
          onClick={startScan}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded"
          disabled={scanning}
        >
          <Camera className="w-4 h-4" />
          {scanning ? "Scanning…" : "Start scanning"}
        </button>

        {scanning && (
          <button
            onClick={stopScan}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded"
          >
            <AlertTriangle className="w-4 h-4" />
            Stop
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded">
          <p>{error}</p>
        </div>
      )}

      <div className="relative border border-dashed border-border-default rounded-md h-72 overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {foundCode && (
        <div className="p-3 bg-surface-muted rounded">
          <p className="text-xs text-text-secondary">Found QR value:</p>
          <p className="font-mono text-sm break-all">{foundCode}</p>
        </div>
      )}

      {meeting && (
        <div className="p-3 bg-surface-default rounded border border-border-default">
          <h2 className="font-semibold text-text-primary">Meeting detected</h2>
          <p className="text-xs text-text-secondary">{meeting.title}</p>
          <p className="text-xs">Status: {meeting.status}</p>
          <p className="text-xs">Attendees: {meeting.attendeesCount}</p>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={attendeeName}
              onChange={(e) => setAttendeeName(e.target.value)}
              className="border border-border-default rounded px-2 py-1 text-sm"
              placeholder="Attendee name"
            />
            <input
              value={attendeeEmail}
              onChange={(e) => setAttendeeEmail(e.target.value)}
              className="border border-border-default rounded px-2 py-1 text-sm"
              placeholder="Attendee email"
            />
          </div>

          <button
            onClick={registerAttendee}
            className="mt-3 px-4 py-2 bg-primary text-white rounded inline-flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Register attendee
          </button>

          {registrationState && (
            <p className="mt-2 text-xs text-text-secondary">{registrationState}</p>
          )}
        </div>
      )}
    </div>
  );
}
