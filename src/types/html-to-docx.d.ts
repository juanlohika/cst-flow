declare module "html-to-docx" {
  function HTMLtoDOCX(html: string, headerHTML: string | null, options?: Record<string, any>): Promise<Buffer>;
  export default HTMLtoDOCX;
}
