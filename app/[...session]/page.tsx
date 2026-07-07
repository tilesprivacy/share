import type { Metadata } from "next"
import SharePage, {
  generateMetadata as generateShareMetadata,
} from "../share/[...session]/page"

interface SharePageProps {
  params: Promise<{ session: string[] }>
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export function generateMetadata(props: SharePageProps): Promise<Metadata> {
  return generateShareMetadata(props)
}

export default SharePage
