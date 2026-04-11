import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

/**
 * PPTX Injector logic for Tarkie Builder.
 * Uses Docxtemplater to map AI content into real PowerPoint placeholders.
 */
export async function injectPptxData(
  templateBuffer: Buffer, 
  data: Record<string, any>
): Promise<Buffer> {
  try {
    // 1. Load the PPTX as a Zip
    const zip = new PizZip(templateBuffer);
    
    // 2. Initialize Docxtemplater
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    
    // 3. Render the data into the slides
    // This is where {client_name} -> "Intel" happens
    doc.render(data);
    
    // 4. Generate the resulting buffer
    const resultBuffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    
    return resultBuffer;
  } catch (error) {
    console.error("PPTX Injection Error:", error);
    throw error;
  }
}
