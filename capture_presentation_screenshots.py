#!/usr/bin/env python3
"""
capture_presentation_screenshots.py
Captures real, ultra-sharp high-DPI screenshots of Yantra ERP for presentation slides:
- Slide 4: Real Teacher Dashboard & Student Dashboard
- Slide 5: Real AI Automation & Agent Chat Interface
- Supplemental: Real Batch Grading & Rubric Evaluation Screen
"""

import os
import time
from playwright.sync_api import sync_playwright

OUTPUT_DIR = "docs/screenshots"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 1440x900 viewport with 2x retina scale factor = 2880x1800 crystal clear slides
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2
        )
        page = context.new_page()

        # ==========================================
        # 1. Login as Teacher (Prof. Adrian Miller)
        # ==========================================
        print("1. Logging in as Teacher...")
        page.goto("http://localhost:5173/signin", wait_until="networkidle")
        time.sleep(1)

        # Fill credentials
        page.fill('input[type="email"]', "prof.adrian@university.edu")
        page.fill('input[type="password"]', "Teacher123")
        page.click('button[type="submit"]')

        # Wait for navigation to dashboard
        page.wait_for_url("**/dashboard", timeout=10000)
        time.sleep(2)

        # ==========================================
        # 2. Capture Slide 4: Teacher Dashboard
        # ==========================================
        print("2. Capturing Slide 4: Teacher Dashboard...")
        dashboard_shot = os.path.join(OUTPUT_DIR, "slide4_teacher_dashboard.png")
        page.screenshot(path=dashboard_shot)
        print(f"   -> Saved: {dashboard_shot}")

        # Also capture full page view of dashboard
        dashboard_full = os.path.join(OUTPUT_DIR, "slide4_teacher_dashboard_full.png")
        page.screenshot(path=dashboard_full, full_page=True)
        print(f"   -> Saved: {dashboard_full}")

        # ==========================================
        # 3. Capture Slide 5: AI Automation & Agent Chat
        # ==========================================
        print("3. Navigating to AI Automation & Agent Chat (/automation)...")
        page.goto("http://localhost:5173/automation", wait_until="networkidle")
        time.sleep(2)

        # If there's an input box to send a sample agent query, type it to show live UI
        chat_input = page.query_selector('textarea, input[placeholder*="Ask"], input[placeholder*="automation"], input[placeholder*="Type"]')
        if chat_input:
            chat_input.fill("Check students with attendance below 75% in division TE-A and draft alert")
            time.sleep(0.5)

        agent_shot = os.path.join(OUTPUT_DIR, "slide5_agent_chat_automation.png")
        page.screenshot(path=agent_shot)
        print(f"   -> Saved: {agent_shot}")

        agent_full = os.path.join(OUTPUT_DIR, "slide5_agent_chat_full.png")
        page.screenshot(path=agent_full, full_page=True)
        print(f"   -> Saved: {agent_full}")

        # Also check /chat-interface if present
        try:
            page.goto("http://localhost:5173/chat-interface", wait_until="networkidle", timeout=5000)
            time.sleep(1.5)
            chat_shot = os.path.join(OUTPUT_DIR, "slide5_chat_interface.png")
            page.screenshot(path=chat_shot)
            print(f"   -> Saved: {chat_shot}")
        except Exception:
            pass

        # ==========================================
        # 4. Capture Grades & Rubric Screen
        # ==========================================
        print("4. Navigating to Batch Grading & Rubrics Screen...")
        page.goto("http://localhost:5173/grade-batch", wait_until="networkidle")
        time.sleep(2)

        grades_shot = os.path.join(OUTPUT_DIR, "grades_rubric_batch.png")
        page.screenshot(path=grades_shot)
        print(f"   -> Saved: {grades_shot}")

        grades_full = os.path.join(OUTPUT_DIR, "grades_rubric_batch_full.png")
        page.screenshot(path=grades_full, full_page=True)
        print(f"   -> Saved: {grades_full}")

        # Try /grades route
        page.goto("http://localhost:5173/grades", wait_until="networkidle")
        time.sleep(2)
        grades_overview = os.path.join(OUTPUT_DIR, "grades_overview.png")
        page.screenshot(path=grades_overview)
        print(f"   -> Saved: {grades_overview}")

        # ==========================================
        # 5. Capture Student Dashboard
        # ==========================================
        print("5. Logging in as Student to capture Student Portal...")
        page.goto("http://localhost:5173/signin", wait_until="networkidle")
        time.sleep(1)
        # Clear token or re-login
        page.evaluate("window.localStorage.clear()")
        page.goto("http://localhost:5173/signin", wait_until="networkidle")
        time.sleep(1)

        page.fill('input[type="email"]', "aarav.sharma@university.edu")
        page.fill('input[type="password"]', "Student123")
        page.click('button[type="submit"]')
        page.wait_for_url("**/dashboard", timeout=10000)
        time.sleep(2)

        student_dash = os.path.join(OUTPUT_DIR, "slide4_student_dashboard.png")
        page.screenshot(path=student_dash)
        print(f"   -> Saved: {student_dash}")

        browser.close()
        print("\nAll presentation screenshots captured successfully!")

if __name__ == "__main__":
    run()

