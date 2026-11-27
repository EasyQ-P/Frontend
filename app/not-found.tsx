// 없는 주소(오타 · 지워진 링크)와 notFound() 화면. 모든 페이지와 함께 전송되므로 서버 컴포넌트로 가볍게 둔다
import { Sticker } from "@/components/Brand";
import { Button, Screen } from "@/components/ui";

export default function NotFound() {
  return (
    <Screen width="narrow">
      <div className="flex flex-1 flex-col items-center px-8 pt-24 text-center">
        <Sticker size={96} rotate={-8} float>
          🧭
        </Sticker>
        <p className="mt-8 text-sm font-semibold text-muted">404</p>
        <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.05em]">페이지를 찾을 수 없어요</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          주소가 바뀌었거나 없는 페이지예요.
          <br />
          강연에 들어가려면 입장 코드를 입력해 주세요.
        </p>
        <div className="mt-auto w-full space-y-3 pb-10 pt-10">
          <Button href="/join" size="lg" className="w-full">
            입장 코드 입력하기
          </Button>
          <Button href="/" size="lg" variant="white" className="w-full">
            처음 화면으로
          </Button>
        </div>
      </div>
    </Screen>
  );
}
