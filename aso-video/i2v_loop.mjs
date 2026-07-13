import { fal } from "@fal-ai/client";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const key = JSON.parse(
  readFileSync(`${homedir()}/.aso-studio/keys.json`, "utf8"),
).FAL_API_KEY.trim();

fal.config({ credentials: key });

const [inputPath, outputPath, prompt, duration = "10"] = process.argv.slice(2);
const image = new File(
  [readFileSync(inputPath)],
  "loop-frame.png",
  { type: "image/png" },
);
const imageURL = await fal.storage.upload(image);

const result = await fal.subscribe(
  "fal-ai/kling-video/o3/4k/image-to-video",
  {
    input: {
      image_url: imageURL,
      end_image_url: imageURL,
      prompt,
      duration,
      generate_audio: false,
    },
    logs: false,
  },
);

const videoURL = result.data?.video?.url ?? result.video?.url;
const response = await fetch(videoURL);
writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
console.log(`saved ${outputPath}`);
