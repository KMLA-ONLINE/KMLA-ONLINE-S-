import { expect, test, type Page } from "@playwright/test";

test("Herald publishes a pasted photo in the requested section", async ({
  page,
  context,
}) => {
  await openHerald(page);
  await unlock(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "New story" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Clipboard photo story");
  await page.getByLabel("Section", { exact: true }).selectOption("misc");
  await page.getByLabel("Story text").fill("Student reporting.");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    canvas.getContext("2d")!.fillRect(0, 0, 1, 1);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG fixture failed")),
        "image/png",
      ),
    );
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": png,
      }),
    ]);
  });
  await page.getByLabel("Story text").focus();
  await page.keyboard.press("Control+V");
  await expect(page.getByRole("status")).toContainText("Selected photo:");
  await page.getByRole("button", { name: "Publish demo" }).click();
  await page.getByLabel("Story section").selectOption("misc");
  await page
    .getByRole("button", { name: "Read: Clipboard photo story" })
    .click();
  const reader = page.getByRole("dialog");
  await expect(reader).toContainText("Student reporting.");
  await expect(reader.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      reader
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await reader.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Magazine" }).click();
  await expect(page.getByText("FROM THE NEWSROOM")).toHaveCount(0);
});

test("Herald bounds multiple polls and archives a scheduled poll automatically", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openHerald(page);
  await page.clock.install({ time: new Date("2026-11-05T02:59:00Z") });
  await unlock(page);
  for (const title of ["Campus priorities", "Next interview"]) {
    await page.getByRole("button", { name: "Create poll" }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Choices, one per line").fill("Yes\nNo");
    await page.getByRole("button", { name: "Publish demo" }).click();
  }
  await page.getByRole("button", { name: "Create poll" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Noon deadline");
  await page
    .getByLabel("Choices, one per line")
    .fill("More interviews\nMore features");
  await page.getByRole("switch", { name: "Close automatically" }).check();
  await page.getByLabel("Closing date (KST)").fill("2026-11-05");
  await page.getByLabel("Hour", { exact: true }).fill("12");
  await page.getByLabel("Minute", { exact: true }).fill("00");
  await page.getByLabel("AM/PM").selectOption("PM");
  await page.screenshot({
    path: testInfo.outputPath("herald-poll-schedule.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Publish demo" }).click();
  await expect(
    page.getByRole("button", { name: "Vote", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "View all polls" }).click();
  const archive = page.getByRole("dialog", { name: "Poll archive" });
  await expect(
    archive.getByRole("button", { name: /^View poll:/ }),
  ).toHaveCount(4);
  await archive
    .getByRole("button", { name: "View poll: Noon deadline" })
    .click();
  const result = page.getByRole("dialog", { name: "Noon deadline" });
  await expect(result).toContainText("12:00 PM KST");
  await page.clock.fastForward(60_000);
  await expect(result).toContainText("Poll closed");
  await expect(
    result.getByRole("radio", { name: "More interviews" }),
  ).toBeDisabled();
  await expect(result).toContainText("0 demo votes");
  await result.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Vote", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "View poll: Noon deadline" }),
  ).toBeVisible();
  await page.locator(".herald-poll-shelf").screenshot({
    path: testInfo.outputPath("herald-poll-shelf.png"),
    animations: "disabled",
  });
});

async function openHerald(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "메뉴", exact: true }).click();
  const herald = page.getByRole("link", { name: "Minjok Herald", exact: true });
  await expect(herald).toHaveAttribute("href", "/menu/herald");
  await herald.click();
  await expect(page.getByRole("tab", { name: "Classic" })).toBeVisible({
    timeout: 15_000,
  });
  await page
    .locator(".herald-story-image img")
    .first()
    .evaluate((image: HTMLImageElement) => image.decode());
}

async function unlock(page: Page) {
  await page.getByRole("button", { name: "Editor access" }).click();
  await page
    .getByLabel("Herald password", { exact: true })
    .fill("herald-preview");
  await page.getByRole("button", { name: "Unlock editor" }).click();
  await expect(page.getByRole("button", { name: "New story" })).toBeVisible();
}

test("Herald menu, layouts, PDF, votes, publishing and metadata history", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openHerald(page);
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("herald-classic.png"),
  });
  await page.getByRole("tab", { name: "Magazine" }).click();
  await expect(page.getByRole("tab", { name: "Magazine" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("herald-magazine.png"),
  });
  await page
    .getByRole("button", {
      name: "Read: The stories we carry beyond the classroom",
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Placeholder photograph",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Read 70th edition" }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  const readerBounds = await page
    .getByTitle("70th edition PDF", { exact: true })
    .boundingBox();
  expect(readerBounds!.width).toBeGreaterThan(1440 * 0.9);
  expect(readerBounds!.height).toBeGreaterThan(1100 * 0.7);
  await page.screenshot({
    path: testInfo.outputPath("herald-pdf-reader.png"),
    animations: "disabled",
  });
  await expect(
    page.getByRole("link", { name: "Open PDF in new tab" }),
  ).toHaveAttribute("href", "/herald/70th-edition.pdf");
  const pdfResponse = await page.request.get("/herald/70th-edition.pdf");
  expect(pdfResponse.ok()).toBe(true);
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const poll = page.getByRole("region", { name: "What should we cover next?" });
  await expect(poll).not.toContainText("demo votes");
  await poll.getByRole("radio", { name: "Everyday campus life" }).check();
  await poll.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(poll).toContainText("92 demo votes");
  await poll.getByRole("radio", { name: "People & their stories" }).check();
  await poll.getByRole("button", { name: "Change vote" }).click();
  await expect(poll).toContainText("92 demo votes");

  await unlock(page);
  await page.getByRole("button", { name: "New story" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Our test newsroom");
  await page
    .getByLabel("Story text")
    .fill("Temporary article body that must not enter history.");
  await page.getByRole("button", { name: "Publish demo" }).click();
  await expect(
    page.getByRole("button", { name: "Read: Our test newsroom" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editorial desk" }).click();
  await page.getByRole("button", { name: "Edit Our test newsroom" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Our updated newsroom");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Editorial desk" }).click();
  await page
    .getByRole("button", { name: "Delete Our updated newsroom" })
    .click();
  await page.getByRole("button", { name: "Delete item" }).click();
  await page.getByRole("button", { name: "Activity history" }).click();
  const history = page.getByRole("dialog", { name: "Activity history" });
  await expect(history.getByRole("listitem")).toHaveCount(3);
  await expect(history.getByRole("link")).toHaveCount(3);
  await expect(history).toContainText("Created");
  await expect(history).toContainText("Edited");
  await expect(history).toContainText("Deleted");
  await expect(history).not.toContainText("Temporary article body");
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("herald-history.png"),
  });
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Editor access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activity history" }),
  ).toHaveCount(0);
  await expect(poll).not.toContainText("demo votes");
  await page.getByRole("button", { name: "View all editions" }).click();
  const archive = page.getByRole("dialog", { name: "Edition archive" });
  await expect(
    archive.getByRole("button", { name: /^Read .* edition$/ }),
  ).toHaveCount(24);
  await page.screenshot({
    path: testInfo.outputPath("herald-archive.png"),
    animations: "disabled",
  });
  await archive.getByRole("button", { name: "Read 1st edition" }).click();
  await expect(
    page.getByRole("link", { name: "Open PDF in new tab" }),
  ).toHaveAttribute("href", "/herald/editions/1st-edition.pdf");
  expect(pageErrors).toEqual([]);
});

test("Herald follows settings theme on mobile and keeps both layouts within the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHerald(page);
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("herald-mobile-classic.png"),
  });
  await page.goto("/settings");
  await page.getByRole("switch", { name: "실험실 기능" }).check();
  await page.goto("/settings/lab");
  await page.getByRole("button", { name: "다크", exact: true }).click();
  await page.goto("/menu/herald");
  await expect(page.locator("html")).toHaveClass(/dark/);
  for (const layout of ["Classic", "Magazine"]) {
    await page.getByRole("tab", { name: layout }).click();
    const bounds = await page.locator(".herald").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(
      await page
        .locator("main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(
        `herald-mobile-dark-${layout.toLowerCase()}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("herald-dark-magazine.png"),
  });
});

test("Herald can preview a selected PDF and create and close a new poll", async ({
  page,
}) => {
  await openHerald(page);
  await unlock(page);
  await page.getByRole("button", { name: "Add edition" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Local edition preview");
  await page.getByLabel("Issue number").fill("73rd");
  await page
    .getByLabel("Edition PDF")
    .setInputFiles("public/herald/70th-edition.pdf");
  await page.getByRole("button", { name: "Publish demo" }).click();
  await page.getByRole("button", { name: "Read 73rd edition" }).click();
  await expect(
    page.getByRole("link", { name: "Open PDF in new tab" }),
  ).toHaveAttribute("href", /^blob:/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Create poll" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Which format do you prefer?");
  await page.getByLabel("Choices, one per line").fill("Classic\nMagazine");
  await page.getByRole("button", { name: "Publish demo" }).click();
  const poll = page.getByRole("region", {
    name: "Which format do you prefer?",
  });
  await poll.getByRole("radio", { name: "Magazine", exact: true }).check();
  await poll.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(poll).toContainText("1 demo votes");
  await poll.getByRole("button", { name: "Close poll" }).click();
  await page.getByRole("button", { name: "Close voting" }).click();
  await page
    .getByRole("button", { name: "View poll: Which format do you prefer?" })
    .click();
  await expect(poll).toContainText("Poll closed");
  await expect(
    poll.getByRole("radio", { name: "Classic", exact: true }),
  ).toBeDisabled();
});
